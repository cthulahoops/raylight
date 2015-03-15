{-# LANGUAGE RecordWildCards #-}
module Main where

import qualified Graphics.UI.GLFW as W
import Graphics.Rendering.OpenGL.Raw
import Graphics.Rendering.OpenGL

import Control.Monad
import Control.Applicative
import Control.Concurrent
import Data.Function
import Data.IORef
import Foreign
import Foreign.C.String

import System.Random

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
    lightObj :: !SceneObject,
    lights :: [RayLight],
    playerLight :: DrawableTexture,
    lightTextures :: ![DrawableTexture],
    shadowUniform :: !GLint,
    colorUniform  :: !GLint,
    locationUniform :: !GLint,
    textureUniform :: !GLint,
    normalUniform :: !GLint,
    posAttrib :: !GLuint,
    normalAttrib :: !GLuint,
    floorTexture :: !GLuint,
    floorNormal :: !GLuint}
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
        lightColor :: Vector3 GLfloat,
        lightPos   :: Vector2 Integer
    } 
    deriving (Show)

makeLight :: RayLight -> [Segment] -> IO (Int, GLuint)
makeLight RayLight{..} segments = do
    let segments' = map (segmentTranslate $ neg lightPos) segments
    let lit = map fromIntegral $ concat $ map (segmentToTriangle lightPos) $ litSegments segments'
    let count = length lit
    buffer <- fillNewBuffer lit
    return $ (count, buffer)

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

data DrawableTexture = DrawableTexture {
    drawableFramebuffer :: !GLuint,
    drawableTexture :: !GLuint
} deriving (Show)

createFrameBuffer :: GLint -> IO DrawableTexture
createFrameBuffer size = do
    -- Create a texture as a render target
    frameBuffer <- withNewPtr (glGenFramebuffers 1)
    glBindFramebuffer gl_FRAMEBUFFER frameBuffer
    putStrLn $ "Framebuffer: " ++ show frameBuffer
  
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
    return $ DrawableTexture frameBuffer renderedTexture

initGLStuff = do
    glClearColor 0.0 0.0 0.0 0
    progScene <- loadProgram "scene.vert" "scene.frag"
    progLight <- loadProgram "light.vert" "light.frag"
    vertexArrayId <- withNewPtr (glGenVertexArrays 1)
    glBindVertexArray vertexArrayId

    glEnable gl_BLEND

    shadowUniform   <- getUniform progScene "shadowTex"
    textureUniform  <- getUniform progScene "texture"
    normalUniform   <- getUniform progScene "normalTexture"
    colorUniform    <- getUniform progScene "drawColor"
    locationUniform <- getUniform progScene "loc"

    posAttrib <- getAttribute progScene "vertexPosition_modelspace"
    normalAttrib <- getAttribute progScene "vertexNormal"

    let lights = [
                    RayLight (Vector3 0.8 0.8 0.8) (Vector2 0 0),
                    RayLight (Vector3 0.8 0.0 0.0) (Vector2 700 (-700)),
                    RayLight (Vector3 0.4 0.0 0.4) (Vector2 (-950) 975),
                    RayLight (Vector3 0.0 0.4 0.4) (Vector2 950 975), 
                    RayLight (Vector3 0.4 0.4 0.0) (Vector2 (-950) (-975))]

    let (verts, norms) = unzip $ map segmentToBox example

    wallObj <- makeSceneObj gl_QUADS (toVertexList $ concat $ verts) (toVertexList $ concat $ norms)
    floorObj <- makeSceneObj gl_QUADS
                    [1000, 1000, 0, 1000, -1000, 0, -1000, -1000, 0, -1000, 1000, 0]
                    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
    

    let vertsp = toVertexList3 $ concat [[Vector3 (30 * sin (2 * pi * t/12)) (30 * cos (2 * pi * t/12)) 30,
         Vector3 (30 * sin (2 * pi * (t+1)/12)) (30 * cos (2 * pi * (t+1)/12)) 30,
         Vector3 0 0 30] | t <- [0..11]]

    playerObj <- makeSceneObj gl_TRIANGLES vertsp vertsp
    lightObj <- makeSceneObj gl_TRIANGLES (map (* 0.3) vertsp) (map (* 0.3) vertsp)

    -- Textures
    texId <- randomRIO (151,200) :: IO Integer
    putStrLn $ "Random texture: " ++ show texId

    floorTexture <- loadBMP $ "50/" ++ show texId ++ ".bmp"
    floorNormal  <- loadBMP $ "50/" ++ show texId ++ "_norm.bmp"

    lightTextures <- replicateM (length lights) $ createFrameBuffer 2048 
    zipWithM_ (renderLight progLight) lights lightTextures

    playerLight <- createFrameBuffer 2048
    return GLIds{..}

renderLight :: GLuint -> RayLight -> DrawableTexture -> IO ()
renderLight progLight light drawable = do
    glBindFramebuffer gl_FRAMEBUFFER (drawableFramebuffer drawable)
    glViewport 0 0 2048 2048
    glClear gl_COLOR_BUFFER_BIT
    glUseProgram progLight
    glEnableVertexAttribArray 0  -- 1st attribute: vertices
    glBlendFunc gl_ONE gl_ONE
    drawLight light
    return ()

drawLight :: RayLight -> IO ()
drawLight light@RayLight{..} = do
    (count, bufferId) <- makeLight light example
    glBindBuffer gl_ARRAY_BUFFER bufferId
    glVertexAttribPointer 0 3 gl_FLOAT (fromBool False) 0 nullPtr
    glDrawArrays gl_TRIANGLES 0 (fromIntegral count)

bindBufferToAttrib bufId attribLoc = do
    glEnableVertexAttribArray attribLoc
    glBindBuffer gl_ARRAY_BUFFER bufId
    glVertexAttribPointer attribLoc 3 gl_FLOAT (fromBool False) 0 nullPtr

data Game = Game {
    gamePosition :: (Integer, Integer),
    gameLight :: Bool
    } deriving (Show)

draw :: GLIds -> Game -> IO ()
draw GLIds{..} Game{..} = do
    let (x,y) = gamePosition
    -- Render light before we do any drawing!
    --
    let playerColor = if gameLight then Vector3 0.8 0.8 0.4 else Vector3 0.0 0.0 0.0

    let pl = RayLight playerColor (Vector2 x y)
    renderLight progLight pl playerLight

    glBindFramebuffer gl_FRAMEBUFFER 0
    glViewport 0 0 800 800

    glClear gl_COLOR_BUFFER_BIT
    glEnableVertexAttribArray 0  -- 1st attribute: vertices

    glUseProgram progScene
    glBlendFunc gl_ONE gl_ZERO

    glActiveTexture gl_TEXTURE1
    glBindTexture gl_TEXTURE_2D floorTexture
    setUniform textureUniform (1 :: Integer)

    glActiveTexture gl_TEXTURE2
    glBindTexture gl_TEXTURE_2D floorNormal
    setUniform normalUniform (2 :: Integer)

    glActiveTexture gl_TEXTURE3
    glBindTexture gl_TEXTURE_2D (drawableTexture playerLight)

    zipWithM_ (\t l -> do
        glActiveTexture t
        glBindTexture gl_TEXTURE_2D l) [gl_TEXTURE4..] (map drawableTexture lightTextures)

    setUniformArray shadowUniform (take 6 [3..] :: [Integer])

    setUniform locationUniform (Vector2 0 (0 :: GLfloat))

    camera <- getUniform progScene "cameraPosition"
    setUniform camera (Vector2 (-x) (-y))

    let allLights = pl:lights

    u <- getUniform progScene "lightPos"
    setUniformArray u [Vector3 (fromIntegral x) (fromIntegral y) (100 :: GLfloat)
        | Vector2 x y <- map lightPos allLights]

    u2 <- getUniform progScene "lightColor"
    setUniformArray u2 $ map lightColor allLights

    em <- getUniform progScene "emmissive"
    setUniform em (Vector3 0 0 (0 :: GLfloat))
 
    -- Draw the floor
    setUniform colorUniform (Vector3 0 0 (0 :: GLfloat))
    drawObject floorObj (posAttrib, normalAttrib)

    -- Disable floor texture
    setUniform textureUniform (0 :: Integer)
    setUniform normalUniform (0 :: Integer)

    -- Draw the walls
    setUniform colorUniform (Vector3 1.0 1.0 (1.0 :: GLfloat))
    drawObject wallObj (posAttrib, normalAttrib)

    -- Draw the player.
    setUniform em playerColor
    setUniform locationUniform (Vector2 x y)
    drawObject playerObj (posAttrib, normalAttrib)
    
    forM_ lights $ \light -> do
        setUniform em $ lightColor light
        setUniform locationUniform $ lightPos light
        drawObject lightObj (posAttrib, normalAttrib)
    glDisableVertexAttribArray 0

pressed window key = do
    ks <- W.getKey window key
    return (ks == W.KeyState'Pressed)

update game W.Key'Up    = withGamePosition game $ \(x,y) -> (x, y + 20)
update game W.Key'Down  = withGamePosition game $ \(x,y) -> (x, y - 20)
update game W.Key'Left  = withGamePosition game $ \(x,y) -> (x - 20, y)
update game W.Key'Right = withGamePosition game $ \(x,y) -> (x + 20, y)

handleEvent game (W.Key'Space, W.KeyState'Pressed) = game {gameLight = not (gameLight game)}
handleEvent game _ = game

withGamePosition game f = game {gamePosition = f (gamePosition game)}

mainLoop window glids frames events state = do
    draw glids state
    W.swapBuffers window

    W.pollEvents

    newEvents <- atomicModifyIORef events (\e -> ([], e)) 

    down <- filterM (pressed window) [W.Key'Up, W.Key'Down, W.Key'Left, W.Key'Right]

    let state' = foldl handleEvent (foldl update state down) newEvents

    ks <- W.getKey window W.Key'Escape
    let continue = ks /= W.KeyState'Pressed

    Just t <- W.getTime
    let delay = round $ 1000000 * (frames / 30 - t)
    if delay > 0 then threadDelay delay else return ()

    when continue (mainLoop window glids (frames + 1) events state')

cleanUpGLStuff GLIds{..} = do
    with vertexArrayId $ glDeleteVertexArrays 1

handleKey events window key n st mod = modifyIORef events (++ [(key, st)])

main = do
    W.init
    Just window <- W.createWindow 800 800 "foo" Nothing Nothing
    W.makeContextCurrent (Just window)
    -- W.enableKeyRepeat
    ids <- initGLStuff
    print ids

    events <- newIORef []
    
    W.setKeyCallback window (Just $ handleKey events)
    mainLoop window ids 0 events Game {gamePosition = (0, 0), gameLight = True}
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
