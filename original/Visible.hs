{-# LANGUAGE RecordWildCards #-}
module Main where

import qualified Graphics.UI.GLFW as W
import Graphics.Rendering.OpenGL.Raw
import Graphics.Rendering.OpenGL

import Control.Monad
import Control.Applicative
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
    wallBufferId  :: !GLuint,
    testBufferId  :: !GLuint,
    vertexCount1 :: Int,
    lights :: [RayLight],
    lightPosUniform :: !GLint,
    lightColorUniform :: !GLint,
    diffuseTexture :: !GLuint,
    wallLightTexture :: !GLuint,
    diffuseUniform :: !GLint,
    colorUniform :: !GLint,
    textureUniform :: !GLint,
    tex :: !GLuint}

segmentToTriangle (Vector2 x0 y0) (Segment (Vector2 x1 y1) (Vector2 x2 y2)) = [x0, y0, 0, x1 + x0, y1 + y0, 0, x2 + x0, y2 + y0, 0]

segmentToLine (Segment (Vector2 x1 y1) (Vector2 x2 y2)) = [x1, y1, 0, x2, y2, 0]

segmentToBox segment@(Segment p1 p2) = [fp1 ^+ norm1, fp2 ^+ norm1, fp2 ^+ norm2, fp1 ^+ norm2]
    where fp1   = fmap fromIntegral p1
          fp2   = fmap fromIntegral p2
          norm1 = 6 ^* norm (Vector2 dy (-dx))
          norm2 = 6 ^* norm (Vector2 (-dy) dx)
          Vector2 dx dy = segmentDirection segment

toVertexList :: [Vector2 GLfloat] -> [GLfloat]
toVertexList vs = concat $ map (\(Vector2 x y) -> [x, y, 0]) vs

fillNewBuffer bufferData = do
    id <- withNewPtr (glGenBuffers 1)
    glBindBuffer gl_ARRAY_BUFFER id
    withArrayLen bufferData $ \length ptr ->
        glBufferData gl_ARRAY_BUFFER (fromIntegral (length * sizeOf (undefined :: GLfloat)))
            (ptr :: Ptr GLfloat) gl_STATIC_DRAW
    return id

data RayLight = RayLight {
        lightPos   :: Vector2 Integer,
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
    return $ RayLight {lightPos = position, lightColor = color, lightVertices = (count, buffer)}

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

    diffuseUniform <- getUniform progScene "diffuse"
    textureUniform <- getUniform progScene "texture"
    colorUniform <- getUniform progScene "drawColor"

    light1 <- makeLight (Vector3 0.4 0.4 0.4) (Vector2 0 0) example
    light2 <- makeLight (Vector3 0.7 0.0 0.0) (Vector2 700 (-700)) example
    light3 <- makeLight (Vector3 0.2 0.0 0.2) (Vector2 (-950) 975) example
    light4 <- makeLight (Vector3 0.0 0.2 0.2) (Vector2 950 975) example
    light5 <- makeLight (Vector3 0.2 0.2 0.0) (Vector2 (-950) (-975)) example
    light6 <- makeLight (Vector3 0.0 0.0 0.2) (Vector2 950 (-975)) example
    let lights = [light1,light2,light3,light4,light5,light6]

    let walls = toVertexList $ concat $ map segmentToBox example
    let vertexCount1 = length walls

    wallBufferId  <- fillNewBuffer walls
   
    testBufferId <- fillNewBuffer [1000, 1000, 0, 1000, -1000, 0, -1000, -1000, 0, -1000, 1000, 0]

    -- Textures
    tex <- loadBMP "imgs/cobble.bmp"

    -- render Lights to frame buffer
    (lightFB, diffuseTexture) <- createFrameBuffer 800
    (wallLightFB, wallLightTexture) <- createFrameBuffer 800

    glBindFramebuffer gl_FRAMEBUFFER lightFB
    glViewport 0 0 800 800
    glClear gl_COLOR_BUFFER_BIT
    glUseProgram progLight
    glEnableVertexAttribArray 0  -- 1st attribute: vertices
    glBlendFunc gl_ONE gl_ONE
    glUniform1f lightHeight 0.1
    mapM_ (drawLight GLIds{..}) lights

    glBindFramebuffer gl_FRAMEBUFFER wallLightFB
    glViewport 0 0 800 800
    glClear gl_COLOR_BUFFER_BIT
    glUseProgram progLight
    glEnableVertexAttribArray 0  -- 1st attribute: vertices
    glBlendFunc gl_ONE gl_ONE
    glUniform1f lightHeight 100
    mapM_ (drawLight GLIds{..}) lights

    glBindFramebuffer gl_FRAMEBUFFER 0
    glViewport 0 0 800 800

    return GLIds{..}

uniformV2 :: GLint -> Vector2 Integer -> IO ()
uniformV2 uniform (Vector2 x y) = glUniform2f uniform (fromIntegral x) (fromIntegral y)

uniformV3 :: GLint -> Vector3 GLfloat -> IO ()
uniformV3 uniform (Vector3 x y z) = glUniform3f uniform x y z

drawLight :: GLIds -> RayLight -> IO ()
drawLight GLIds{..} RayLight{..} = do
    uniformV2 lightPosUniform lightPos
    uniformV3 lightColorUniform lightColor
    let (count, bufferId) = lightVertices
    glBindBuffer gl_ARRAY_BUFFER bufferId
    glVertexAttribPointer 0 3 gl_FLOAT (fromBool False) 0 nullPtr
    glDrawArrays gl_TRIANGLES 0 (fromIntegral count)

draw GLIds{..} = do
    glClear gl_COLOR_BUFFER_BIT
    glEnableVertexAttribArray 0  -- 1st attribute: vertices

    glUseProgram progScene
    
    glActiveTexture gl_TEXTURE1
    glBindTexture gl_TEXTURE_2D diffuseTexture
    glUniform1i diffuseUniform 1

    glActiveTexture gl_TEXTURE2
    glBindTexture gl_TEXTURE_2D tex
    glUniform1i textureUniform 2

    -- Draw the floor
    glUniform3f colorUniform 0 0 0
    glBlendFunc gl_ONE gl_ZERO
    glBindBuffer gl_ARRAY_BUFFER testBufferId
    glVertexAttribPointer 0 3 gl_FLOAT (fromBool False) 0 nullPtr 
    glDrawArrays gl_QUADS 0 4

    glUniform1i textureUniform 0

    glActiveTexture gl_TEXTURE1
    glBindTexture gl_TEXTURE_2D wallLightTexture
    glUniform1i diffuseUniform 1

    -- Draw the walls
    glUniform3f colorUniform 1.0 1.0 1.0
    glBlendFunc gl_ONE gl_ZERO
    glBindBuffer gl_ARRAY_BUFFER wallBufferId
    glVertexAttribPointer 0 3 gl_FLOAT (fromBool False) 0 nullPtr 
    glDrawArrays gl_QUADS 0 (fromIntegral vertexCount1)

    glDisableVertexAttribArray 0
    W.swapBuffers window
    W.pollEvents
    ks <- W.getKey window W.Key'Escape
    let continue = ks /= W.KeyState'Pressed
    when continue loop

cleanUpGLStuff GLIds{..} = do
    with wallBufferId $ glDeleteBuffers 1
    with vertexArrayId $ glDeleteVertexArrays 1

main = do
    W.init
    Just window <- W.createWindow 800 800 "foo" Nothing Nothing
    W.makeContextCurrent (Just window)
    -- W.enableKeyRepeat
    ids <- initGLStuff
    mainLoop window ids
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
