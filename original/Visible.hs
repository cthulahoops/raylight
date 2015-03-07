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

import Vector
import Shaders
import RayLighting

data GLIds = GLIds {
    progScene :: !GLuint,
    progLight :: !GLuint,
    vertexArrayId :: !GLuint,
    wallBufferId  :: !GLuint,
    vertexCount1 :: Int,
    lights :: [RayLight],
    lightPosUniform :: !GLint,
    lightColorUniform :: !GLint}

segmentToTriangle (Vector2 x0 y0) (Segment (Vector2 x1 y1) (Vector2 x2 y2)) = [x0, y0, 0, x1 + x0, y1 + y0, 0, x2 + x0, y2 + y0, 0]

segmentToLine (Segment (Vector2 x1 y1) (Vector2 x2 y2)) = [x1, y1, 0, x2, y2, 0]

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

initGLStuff = do
  glClearColor 0.02 0.02 0.05 0
  progScene <- loadProgram "simple.vert" "simple.frag"
  progLight <- loadProgram "simple.vert" "light.frag"
  vertexArrayId <- withNewPtr (glGenVertexArrays 1)
  glBindVertexArray vertexArrayId

  glEnable gl_BLEND

  lightPosUniform <- getUniform progLight "lightPos"
  lightColorUniform <- getUniform progLight "lightColor"
  
  light1 <- makeLight (Vector3 0 0 1.0) (Vector2 0 0) example
  light2 <- makeLight (Vector3 0.2 0.7 0.2) (Vector2 700 (-700)) example
  light3 <- makeLight (Vector3 1.0 0 1.0) (Vector2 (-950) 975) example
  let lights = [light1, light2, light3]

  let walls = map fromIntegral $ concat $ map segmentToLine example

  let vertexCount1 = length walls

  wallBufferId  <- fillNewBuffer walls

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
    glVertexAttribPointer 0  -- attribute 0 in the shader
                          3  -- we draw 3 vertices
                          gl_FLOAT  -- coordinates type
                          (fromBool False)  -- normalized?
                          0  -- stride
                          nullPtr  -- vertex buffer offset
    glDrawArrays gl_TRIANGLES 0 (fromIntegral count)
    
mainLoop window glids@GLIds{..} = fix $ \loop -> do
  glClear gl_COLOR_BUFFER_BIT
  glEnableVertexAttribArray 0  -- 1st attribute: vertices

  glBlendFunc gl_ONE gl_ONE

  glUseProgram progLight
  mapM_ (drawLight glids) lights

  glUseProgram progScene
  glBlendFunc gl_ONE gl_ZERO
  glBindBuffer gl_ARRAY_BUFFER wallBufferId
  glVertexAttribPointer 0 3 gl_FLOAT (fromBool False) 0 nullPtr 
  glDrawArrays gl_LINES 0 (fromIntegral vertexCount1)

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
  let success = True
  when (not success) $ do
    W.terminate
-- W.enableKeyRepeat
  ids <- initGLStuff
  mainLoop window ids
  cleanUpGLStuff ids
  W.terminate
