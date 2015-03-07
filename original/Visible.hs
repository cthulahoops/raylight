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
    lightBufferId1 :: !GLuint,
    lightBufferId2 :: !GLuint,
    vertexCount1 :: Int,
    vertexCount2 :: Int,
    vertexCount3 :: Int,
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

initGLStuff = do
  glClearColor 0.02 0.02 0.05 0
  progScene <- loadProgram "simple.vert" "simple.frag"
  progLight <- loadProgram "simple.vert" "light.frag"
  vertexArrayId <- withNewPtr (glGenVertexArrays 1)
  glBindVertexArray vertexArrayId

  glEnable gl_BLEND

  lightPosUniform <- getUniform progLight "lightPos"
  lightColorUniform <- getUniform progLight "lightColor"

 -- glBlendFunc gl_ZERO gl_DST_COLOR
  let light1 = Vector2 0 0
  let light2 = Vector2 700 (-700)
  let segments1 = map (segmentTranslate $ neg light1) $ example
  let segments2 = map (segmentTranslate $ neg light2) $ example

  let walls = map fromIntegral $ concat $ map segmentToLine example

  let lit1 = map fromIntegral $ concat $ map (segmentToTriangle light1) $ litSegments segments1
  let lit2 = map fromIntegral $ concat $ map (segmentToTriangle light2) $ litSegments segments2

  let vertexCount1 = length walls
  let vertexCount2 = length lit1
  let vertexCount3 = length lit2

  wallBufferId  <- fillNewBuffer walls
  lightBufferId1 <- fillNewBuffer lit1
  lightBufferId2 <- fillNewBuffer lit2

  return GLIds{..}

mainLoop window GLIds{..} = fix $ \loop -> do
  glClear gl_COLOR_BUFFER_BIT
  glEnableVertexAttribArray 0  -- 1st attribute: vertices

  glBlendFunc gl_ONE gl_ONE

  glUseProgram progLight
  glUniform2f lightPosUniform 0 0
  glUniform3f lightColorUniform 0.0 0.0 1.0
  glBindBuffer gl_ARRAY_BUFFER lightBufferId1
  glVertexAttribPointer 0  -- attribute 0 in the shader
                        3  -- we draw 3 vertices
                        gl_FLOAT  -- coordinates type
                        (fromBool False)  -- normalized?
                        0  -- stride
                        nullPtr  -- vertex buffer offset
  glDrawArrays gl_TRIANGLES 0 (fromIntegral vertexCount2)  -- from 0, 3 vertices

  glUniform2f lightPosUniform 700 (-700)
  glUniform3f lightColorUniform 0.2 0.7 0.2
  glBindBuffer gl_ARRAY_BUFFER lightBufferId2
  glVertexAttribPointer 0  -- attribute 0 in the shader
                        3  -- we draw 3 vertices
                        gl_FLOAT  -- coordinates type
                        (fromBool False)  -- normalized?
                        0  -- stride
                        nullPtr  -- vertex buffer offset
  glDrawArrays gl_TRIANGLES 0 (fromIntegral vertexCount3)  -- from 0, 3 vertices

  glUseProgram progScene
  glBlendFunc gl_ONE gl_ZERO
  glBindBuffer gl_ARRAY_BUFFER wallBufferId
  glVertexAttribPointer 0  -- attribute 0 in the shader
                        3  -- we draw 3 vertices
                        gl_FLOAT  -- coordinates type
                        (fromBool False)  -- normalized?
                        0  -- stride
                        nullPtr  -- vertex buffer offset
  glDrawArrays gl_LINES 0 (fromIntegral vertexCount1)  -- from 0, 3 vertices


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
