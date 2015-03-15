{-# LANGUAGE FlexibleInstances #-}
module Shaders where

import Graphics.Rendering.OpenGL hiding (Uniform)
import Graphics.Rendering.OpenGL.Raw
import Foreign
import Foreign.C.String
import Control.Applicative
import Control.Monad

withNewPtr f = alloca (\p -> f p >> peek p)

loadProgram vertFP fragFP = do
  shaderIds <- sequence [
    loadShader gl_VERTEX_SHADER vertFP,
    loadShader gl_FRAGMENT_SHADER fragFP]
  progId <- glCreateProgram
  mapM_ (glAttachShader progId) shaderIds
  glLinkProgram progId
  checkStatus gl_LINK_STATUS glGetProgramiv glGetProgramInfoLog progId
  mapM_ glDeleteShader shaderIds
  return progId

loadShader shaderTypeFlag filePath = do
  putStrLn $ "Loading " ++ filePath
  code <- readFile filePath
  id <- glCreateShader shaderTypeFlag
  withCString code $ \codePtr ->
    with codePtr $ \codePtrPtr ->
      glShaderSource id 1 codePtrPtr nullPtr
  glCompileShader id
  checkStatus gl_COMPILE_STATUS glGetShaderiv glGetShaderInfoLog id
  return id

checkStatus statusFlag glGetFn glInfoLogFn id = do
  let fetch info = withNewPtr (glGetFn id info)
  status <- toBool <$> fetch statusFlag
  logLength <- fetch gl_INFO_LOG_LENGTH
  when (logLength > 0) $
    allocaArray0 (fromIntegral logLength) $ \msgPtr -> do
       glInfoLogFn id logLength nullPtr msgPtr
       peekCString msgPtr >>= \msg -> putStrLn ("shader: " ++ msg)
  return status

getAttribute :: GLuint -> String -> IO GLuint
getAttribute progId name = fromIntegral <$> (withCString name $ glGetAttribLocation progId)

getUniform :: GLuint -> String -> IO GLint
getUniform progId name = fromIntegral <$> (withCString name $ glGetUniformLocation progId)

type GLuniform = GLint

class Uniform a where
    setUniform :: GLuniform -> a -> IO ()
    setUniformArray :: GLuniform -> [a] -> IO ()

instance Uniform (Vector3 GLfloat) where 
    setUniform uniform (Vector3 x y z) = glUniform3f uniform x y z
    setUniformArray uniform vs = let ps = concat $ [[x, y, z] | Vector3 x y z <- vs]
                                    in withArray ps $ glUniform3fv uniform (fromIntegral $ length ps)

instance Uniform (Vector2 GLfloat) where 
    setUniform uniform (Vector2 x y) = glUniform2f uniform x y

instance Uniform (Vector2 Integer) where 
    setUniform uniform (Vector2 x y) = glUniform2f uniform (fromIntegral x) (fromIntegral y)

instance Uniform Integer where
    setUniform uniform x = glUniform1i uniform (fromIntegral x)
    setUniformArray uniform xs = withArray (map fromIntegral xs) $ glUniform1iv uniform (fromIntegral $ length xs)
