module Vector where

import Graphics.Rendering.OpenGL
import Control.Applicative

class Vector v where 
    neg :: Num a => v a -> v a
    neg v = (-1) ^* v
    (^-) :: Num a => v a -> v a -> v a
    (^+) :: Num a => v a -> v a -> v a
    (^*) :: Num a => a -> v a -> v a
    (^/) :: Fractional a => v a -> a -> v a
    (^.) :: Num a => v a -> v a -> a
    sqMag :: (Num a) => v a -> a
    sqMag v1 = v1 ^. v1
    mag :: (Integral a, Floating b) => v a -> b
    mag = sqrt . fromIntegral . sqMag
    norm :: (Functor v, Integral a, Fractional b, Floating b) => v a -> v b
    norm v = fmap fromIntegral v ^/ mag v

instance Vector Vector3 where
    (^-) = liftA2 (-)
    (^+) = liftA2 (+)
    s ^* v = liftA (s *) v
    v ^/ s = liftA (/ s) v
    (Vector3 x1 y1 z1) ^. (Vector3 x2 y2 z2) = (x1 * x2) + (y1 + y2) + (z1 * z2)

instance Vector Vector2 where
    (^-) = liftA2 (-)
    (^+) = liftA2 (+)
    s ^* v = liftA (s *) v
    v ^/ s = liftA (/ s) v
    (Vector2 x1 y1) ^. (Vector2 x2 y2) = (x1 * x2) + (y1 * y2)


toVector (Vertex3 x y z) = Vector3 x y z
toNormal (Vector3 x y z) = Normal3 x y z

xy (Vector3 x y z) = Vector2 x y

(Vector3 x1 y1 z1) `cross` (Vector3 x2 y2 z2) = Vector3 (y1 * z2 - y2 * z1) (z1 * x2 - z2 * x1) (x1 * y2 - x2 * y1)
