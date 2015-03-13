{-# LANGUAGE RecordWildCards #-}
module Main where

import qualified Graphics.UI.GLFW as W
import Graphics.Rendering.OpenGL.Raw
import Graphics.Rendering.OpenGL

import Control.Monad
import Control.Applicative
import Control.Concurrent
import Data.Function
import Foreign
import Foreign.C.String

import BMP

import Vector
import Shaders
import RayLighting

data GLIds = GLIds {
    progScene :: !GLuint,
    progLight :: !GLuint,
    vertexArrayId :: !GLuint,
    floorObj :: !SceneObject,
    wallObj  :: !SceneObject,
    playerObj :: !SceneObject,
    lights :: [RayLight],
    lightPosUniform :: !GLint,
    lightColorUniform :: !GLint,
    lightTexture1 :: !GLuint,
    lightTexture2 :: !GLuint,
    diffuse1 :: !GLint,
    diffuse2 :: !GLint,
    colorUniform :: !GLint,
    locationUniform :: !GLint,
    textureUniform :: !GLint,
    posAttrib :: !GLuint,
    normalAttrib :: !GLuint,
    tex :: !GLuint}
    deriving (Show)

segmentToTriangle (Vector2 x0 y0) (Segment (Vector2 x1 y1) (Vector2 x2 y2)) = [x0, y0, 0, x1 + x0, y1 + y0, 0, x2 + x0, y2 + y0, 0]

segmentToLine (Segment (Vector2 x1 y1) (Vector2 x2 y2)) = [x1, y1, 0, x2, y2, 0]

segmentToBox segment@(Segment p1 p2) = (verts, norms)
    where verts = [fp1 ^+ norm1, fp2 ^+ norm1, fp2 ^+ norm2, fp1 ^+ norm2]
          norms = [norm1, norm1, norm2, norm2]
          fp1   = fmap fromIntegral p1
          fp2   = fmap fromIntegral p2
          norm1 = 6 ^* norm (Vector2 dy (-dx))
          norm2 = 6 ^* norm (Vector2 (-dy) dx)
          Vector2 dx dy = segmentDirection segment

toVertexList :: [Vector2 GLfloat] -> [GLfloat]
toVertexList vs = concat $ map (\(Vector2 x y) -> [x, y, 0]) vs

toVertexList3 :: [Vector3 GLfloat] -> [GLfloat]
toVertexList3 vs = concat $ map (\(Vector3 x y z) -> [x, y, z]) vs

fillNewBuffer bufferData = do
    id <- withNewPtr (glGenBuffers 1)
    glBindBuffer gl_ARRAY_BUFFER id
    withArrayLen bufferData $ \length ptr ->
        glBufferData gl_ARRAY_BUFFER (fromIntegral (length * sizeOf (undefined :: GLfloat)))
            (ptr :: Ptr GLfloat) gl_STATIC_DRAW
    return id

type GLtexture = GLuint
type GLuniform = GLint

data RayLight = RayLight {
        lightPos   :: Vector3 Integer,
        lightColor :: Vector3 GLfloat,
        lightVertices :: !(Int, GLuint)
    } 
    deriving (Show)

makeLight :: Vector3 GLfloat -> Vector2 Integer -> [Segment] -> IO RayLight
makeLight color position segments = do
    let segments' = map (segmentTranslate $ neg position) segments
    let lit = map fromIntegral $ concat $ map (segmentToTriangle position) $ litSegments segments'
    let count = length lit
    buffer <- fillNewBuffer lit
    return $ RayLight {lightPos = withHeight position, lightColor = color, lightVertices = (count, buffer)}
    where withHeight (Vector2 x y) = Vector3 x y 50

data SceneObject = SceneObject {
        soPosition :: !GLuint,
        soNormals  :: !GLuint,
        soCount    :: !Int,
        soPoly     :: !GLuint
    } deriving (Show)

makeSceneObj poly verts norms = do
    positionBuffer <- fillNewBuffer verts
    normalBuffer   <- fillNewBuffer norms
    return $ SceneObject {
        soPosition = positionBuffer,
        soNormals = normalBuffer,
        soPoly  = poly, 
        soCount = length verts}

drawObject obj (posAttrib, normalAttrib) = do
    bindBufferToAttrib (soPosition obj) posAttrib
    bindBufferToAttrib (soNormals obj) normalAttrib
    glDrawArrays (soPoly obj) 0 (fromIntegral $ soCount obj)

createFrameBuffer :: GLint -> IO (GLuint, GLuint)
createFrameBuffer size = do
    -- Create a texture as a render target
    fb <- withNewPtr (glGenFramebuffers 1)
    glBindFramebuffer gl_FRAMEBUFFER fb
    putStrLn $ "Framebuffer: " ++ show fb
  
    -- The texture we're going to render to
    renderedTexture <- withNewPtr (glGenTextures 1)
    -- "Bind" the newly created texture : all future texture functions will modify this texture
    glBindTexture gl_TEXTURE_2D renderedTexture

    -- Give an empty image to OpenGL ( the last "0" )
    glTexImage2D gl_TEXTURE_2D 0 3 size size 0 gl_RGB gl_UNSIGNED_BYTE nullPtr

    -- Poor filtering. Needed !
    glTexParameteri gl_TEXTURE_2D gl_TEXTURE_MAG_FILTER (fromIntegral gl_NEAREST)
    glTexParameteri gl_TEXTURE_2D gl_TEXTURE_MIN_FILTER (fromIntegral gl_NEAREST)

    -- The depth buffer
    depthBuffer <- withNewPtr (glGenRenderbuffers 1)
    glBindRenderbuffer gl_RENDERBUFFER depthBuffer

    glRenderbufferStorage gl_RENDERBUFFER gl_DEPTH_COMPONENT size size
    glFramebufferRenderbuffer gl_FRAMEBUFFER gl_DEPTH_ATTACHMENT gl_RENDERBUFFER depthBuffer

    -- Set "renderedTexture" as our colour attachement #0
    glFramebufferTexture gl_FRAMEBUFFER gl_COLOR_ATTACHMENT0 renderedTexture 0
     
    -- Set the list of draw buffers.
    --  p <- malloc
    --  GLenum DrawBuffers[1] = {GL_COLOR_ATTACHMENT0};
    --  glDrawBuffers(1, DrawBuffers); // "1" is the size of DrawBuffers
    glDrawBuffer gl_COLOR_ATTACHMENT0

    status <- glCheckFramebufferStatus gl_FRAMEBUFFER 
    when (status /= gl_FRAMEBUFFER_COMPLETE) $ fail "Incomplete framebuffer"
    return (fb, renderedTexture)

initGLStuff = do
    glClearColor 0.0 0.0 0.0 0
    progScene <- loadProgram "scene.vert" "scene.frag"
    progLight <- loadProgram "light.vert" "light.frag"
    vertexArrayId <- withNewPtr (glGenVertexArrays 1)
    glBindVertexArray vertexArrayId

    glEnable gl_BLEND

    lightPosUniform   <- getUniform progLight "lightPos"
    lightColorUniform <- getUniform progLight "lightColor"
    lightHeight       <- getUniform progLight "lightHeight"

    diffuse1 <- getUniform progScene "diffuse1"
    diffuse2 <- getUniform progScene "diffuse2"
    textureUniform  <- getUniform progScene "texture"
    colorUniform    <- getUniform progScene "drawColor"
    locationUniform <- getUniform progScene "loc"

    posAttrib <- getAttribute progScene "vertexPosition_modelspace"
    normalAttrib <- getAttribute progScene "vertexNormal"

    light1 <- makeLight (Vector3 0.0 0.0 0.8) (Vector2 0 0) example
    light2 <- makeLight (Vector3 0.8 0.0 0.0) (Vector2 700 (-700)) example
    light3 <- makeLight (Vector3 0.2 0.0 0.2) (Vector2 (-950) 975) example
    light4 <- makeLight (Vector3 0.0 0.2 0.2) (Vector2 950 975) example
    light5 <- makeLight (Vector3 0.2 0.2 0.0) (Vector2 (-950) (-975)) example
    light6 <- makeLight (Vector3 0.0 0.0 0.2) (Vector2 950 (-975)) example
    let lights = [light1,light2,light3,light4,light5,light6]

    let (verts, norms) = unzip $ map segmentToBox example

    wallObj <- makeSceneObj gl_QUADS (toVertexList $ concat $ verts) (toVertexList $ concat $ norms)
    floorObj <- makeSceneObj gl_QUADS
                    [1000, 1000, 0, 1000, -1000, 0, -1000, -1000, 0, -1000, 1000, 0]
                    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
    

    let vertsp = toVertexList3 $ concat [[Vector3 (30 * sin (2 * pi * t/12)) (30 * cos (2 * pi * t/12)) 30,
         Vector3 (30 * sin (2 * pi * (t+1)/12)) (30 * cos (2 * pi * (t+1)/12)) 30,
         Vector3 0 0 30] | t <- [0..11]]

    playerObj <- makeSceneObj gl_TRIANGLES vertsp vertsp

    -- Textures
    tex <- loadBMP "imgs/cobble.bmp"

    lightTexture1 <- renderLight progLight light1
    lightTexture2 <- renderLight progLight light2

    return GLIds{..}


renderLight :: GLuint -> RayLight -> IO GLtexture
renderLight progLight light = do
    (lightFB, lightTexture) <- createFrameBuffer 800

    lightHeight       <- getUniform progLight "lightHeight"
    lightPosUniform   <- getUniform progLight "lightPos"
    lightColorUniform <- getUniform progLight "lightColor"

    glBindFramebuffer gl_FRAMEBUFFER lightFB
    glViewport 0 0 800 800
    glClear gl_COLOR_BUFFER_BIT
    glUseProgram progLight
    glEnableVertexAttribArray 0  -- 1st attribute: vertices
    glBlendFunc gl_ONE gl_ONE
    glUniform1f lightHeight 0.1
    drawLight lightPosUniform lightColorUniform light
    return lightTexture

uniformV2 :: GLint -> Vector2 Integer -> IO ()
uniformV2 uniform (Vector2 x y) = glUniform2f uniform (fromIntegral x) (fromIntegral y)

uniformV3i :: GLint -> Vector3 Integer -> IO ()
uniformV3i uniform (Vector3 x y z) = glUniform3f uniform (fromIntegral x) (fromIntegral y) (fromIntegral z)

uniformV3 :: GLint -> Vector3 GLfloat -> IO ()
uniformV3 uniform (Vector3 x y z) = glUniform3f uniform x y z


drawLight :: GLuniform -> GLuniform -> RayLight -> IO ()
drawLight lightPosUniform lightColorUniform RayLight{..} = do
    uniformV3i lightPosUniform lightPos
    uniformV3 lightColorUniform lightColor
    let (count, bufferId) = lightVertices
    glBindBuffer gl_ARRAY_BUFFER bufferId
    glVertexAttribPointer 0 3 gl_FLOAT (fromBool False) 0 nullPtr
    glDrawArrays gl_TRIANGLES 0 (fromIntegral count)

bindBufferToAttrib bufId attribLoc = do
    glEnableVertexAttribArray attribLoc
    glBindBuffer gl_ARRAY_BUFFER bufId
    glVertexAttribPointer attribLoc 3 gl_FLOAT (fromBool False) 0 nullPtr

draw GLIds{..} (x, y) = do
    glBindFramebuffer gl_FRAMEBUFFER 0
    glViewport 0 0 800 800

    glClear gl_COLOR_BUFFER_BIT
    glEnableVertexAttribArray 0  -- 1st attribute: vertices

    glUseProgram progScene
    glBlendFunc gl_ONE gl_ZERO

    glActiveTexture gl_TEXTURE1
    glBindTexture gl_TEXTURE_2D tex
    glUniform1i textureUniform 1

    glActiveTexture gl_TEXTURE2
    glBindTexture gl_TEXTURE_2D lightTexture1
    glUniform1i diffuse1 2

    glActiveTexture gl_TEXTURE3
    glBindTexture gl_TEXTURE_2D lightTexture2
    glUniform1i diffuse2 3

    glUniform2f locationUniform 0 0
    u1 <- getUniform progScene "lightPos1"
    uniformV3i u1 (lightPos $ head $ lights)
    
    u2 <- getUniform progScene "lightPos2"
    uniformV3i u2 (lightPos $ head $ tail lights)
 
    -- Draw the floor
    glUniform3f colorUniform 0 0 0
    drawObject floorObj (posAttrib, normalAttrib)

    -- Disable floor texture
    glUniform1i textureUniform 0

    -- Draw the walls
    glUniform3f colorUniform 1.0 1.0 1.0
    drawObject wallObj (posAttrib, normalAttrib)

    -- Draw the player.
    glUniform2f locationUniform x y 
    glUniform3f colorUniform 1.0 1.0 1.0
    drawObject playerObj (posAttrib, normalAttrib)
    glDisableVertexAttribArray 0

pressed window key = do
    ks <- W.getKey window key
    return (ks == W.KeyState'Pressed)

update (x, y) W.Key'Up = (x, y + 20)
update (x, y) W.Key'Down = (x, y - 20)
update (x, y) W.Key'Left = (x - 20, y)
update (x, y) W.Key'Right = (x + 20, y)

mainLoop window glids frames state = do
    draw glids state
    W.swapBuffers window

    W.pollEvents

    down <- filterM (pressed window) [W.Key'Up, W.Key'Down, W.Key'Left, W.Key'Right]
    let state' = foldl update state down

    ks <- W.getKey window W.Key'Escape
    let continue = ks /= W.KeyState'Pressed

    Just t <- W.getTime
    let delay = round $ 1000000 * (frames / 30 - t)
    if delay > 0 then threadDelay delay else return ()

    when continue (mainLoop window glids (frames + 1) state')

cleanUpGLStuff GLIds{..} = do
    with vertexArrayId $ glDeleteVertexArrays 1

main = do
    W.init
    Just window <- W.createWindow 800 800 "foo" Nothing Nothing
    W.makeContextCurrent (Just window)
    -- W.enableKeyRepeat
    ids <- initGLStuff
    print ids
    mainLoop window ids 0 (0, 0)
    cleanUpGLStuff ids
    W.terminate

loadBMP name = do
    (width, height, dat) <- bitmapLoadRaw name
    texId <- withNewPtr (glGenTextures 1)
    print texId
    glBindTexture gl_TEXTURE_2D texId
--   glTexParameteri gl_TEXTURE_2D gl_TEXTURE_BASE_LEVEL 0
--   glTexParameteri gl_TEXTURE_2D gl_TEXTURE_MAX_LEVEL 0
    glTexImage2D gl_TEXTURE_2D 0 3 width height 0 gl_BGR gl_UNSIGNED_BYTE dat
    glTexParameteri gl_TEXTURE_2D gl_TEXTURE_WRAP_S (fromIntegral gl_REPEAT)
    glTexParameteri gl_TEXTURE_2D gl_TEXTURE_WRAP_T (fromIntegral gl_REPEAT)
    glTexParameteri gl_TEXTURE_2D gl_TEXTURE_MAG_FILTER (fromIntegral gl_LINEAR)
    glTexParameteri gl_TEXTURE_2D gl_TEXTURE_MIN_FILTER (fromIntegral gl_LINEAR_MIPMAP_LINEAR)
    glGenerateMipmap gl_TEXTURE_2D
    return texId
