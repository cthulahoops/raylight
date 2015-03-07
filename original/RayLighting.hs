module RayLighting where

import Vector
import Data.Function
import Data.List hiding (intersect)
import Graphics.Rendering.OpenGL
import Data.Maybe
import qualified Control.Monad.State as St
import Control.Monad
import Data.Ratio

type Coord = Integer
type Orth = Vector2 Coord
type Ray  = Vector2 Coord

data PointType = End | Start | Neither deriving (Eq, Ord, Show)

data Segment = Segment {
        segmentStart :: Orth,
        segmentEnd :: Orth}
    deriving (Show, Eq)

data LineEq = LineEq Coord Coord Coord
    deriving (Show)

example = [
            Segment (Vector2 (-1000) 1000) (Vector2 1000 1000),
            Segment (Vector2 (-1000) (-1000)) (Vector2 1000 (-1000)),
            Segment (Vector2 1000 (-1000)) (Vector2 (1000) (1000)),
            Segment (Vector2 (-1000) (-1000)) (Vector2 (-1000) 1000),
            Segment (Vector2 (-800) 800) (Vector2 800 800),
            Segment (Vector2 800 800) (Vector2 800 (-800)),
            Segment (Vector2 (-45) 500) (Vector2 500 500),
            Segment (Vector2 100 300) (Vector2 100 500),
            Segment (Vector2 200 100) (Vector2 300 400),
            Segment (Vector2 600 200) (Vector2 600 (-200)),
            Segment (Vector2 65 (-700)) (Vector2 (-300) (-800)),
            Segment (Vector2 (-700) (700)) (Vector2 (-700) (-200)),
            Segment (Vector2 (-700) (700)) (Vector2 (-700) (200)),
            Segment (Vector2 (-300) (05)) (Vector2 (-300) (50))
            ]

segmentDirection s = segmentEnd s ^- segmentStart s

segmentTranslate offset (Segment s e) = fixOrientation $ Segment (s ^+ offset) (e ^+ offset)

fixOrientation segment = if visibleAngle segment > pi then flipSegment segment else segment

flipSegment segment    = Segment (segmentEnd segment) (segmentStart segment)

visibleAngle :: Segment -> GLfloat
visibleAngle segment = if raw < 0 then raw + 2 * pi else raw
    where raw = theta (segmentEnd segment) - theta (segmentStart segment)

theta (Vector2 x y) = atan2 (fromIntegral y) (fromIntegral x)

deleteAll x xs = filter (/=x) xs

intersections :: Ray -> [Segment] -> [(Orth, Segment)]
intersections ray segments = catMaybes $ map (\s -> intersect ray s >>= \p -> Just (p, s)) segments

intersect :: Orth -> Segment -> Maybe Orth
intersect ray segment = do
    p <- unboundedIntersect ray segment
    guard (sameQuadrant ray p && inSegment p segment)
    return p

inSegment :: Orth -> Segment -> Bool
inSegment (Vector2 x y) (Segment (Vector2 x1 y1) (Vector2 x2 y2)) = between x x1 x2 && between y y1 y2

between x x1 x2 = x >= min x1 x2 && x <= max x1 x2

unboundedIntersect :: Orth -> Segment -> Maybe Orth
unboundedIntersect ray segment = lineIntersect (toLineEq (Segment (Vector2 0 0) ray)) (toLineEq segment)

pseudoAngle :: Orth -> Rational
pseudoAngle (Vector2 x y) = if x < 0 then 2 - p else p
    where p = fromIntegral y % fromIntegral (abs x + abs y)

sameQuadrant v1 v2 = (v1 ^. v2) > 0

toLineEq :: Segment -> LineEq
toLineEq (Segment (Vector2 x1 y1) (Vector2 x2 y2)) = LineEq a b (a * x1 + b * y1)
    where a = y2 - y1
          b = x1 - x2

lineIntersect :: LineEq -> LineEq -> Maybe Orth
lineIntersect (LineEq a1 b1 c1) (LineEq a2 b2 c2) = if det == 0 then Nothing else Just $ Vector2 x y
    where det = a1 * b2 - a2 * b1
          x = (b2 * c1 - b1 * c2) `div` det
          y = (a1 * c2 - a2 * c1) `div` det

closest [] = (Vector2 0 0, Segment (Vector2 100 0) (Vector2 (-100) 0))
closest ps = minimumBy (compare `on` cmp) $ ps
    where cmp (point, segment) = (sqMag point, point ^. segmentDirection segment) 

litSegments :: [Segment] -> [Segment]
litSegments segments = St.evalState (mapM f (angles ++ [(Neither, Vector2 0 (-1), undefined)])) (Vector2 0 (-1), initWalls)
    where f (pointType, v', segment) = do
            (v, walls) <- St.get
            let walls' = addRemove pointType segment walls
            St.put (v', walls')
            let (p1, _) = closest $ intersections v walls
            let (p2, _) = closest $ intersections v' walls
            return $ Segment p1 p2
          initWalls = map snd $ intersections (Vector2 0 (-1)) segments
          addRemove Start segment walls = (segment:walls)
          addRemove End segment walls = deleteAll segment walls
          addRemove Neither segment walls = walls
          angles = sortBy (compare `on` (\(t, v, _) -> (pseudoAngle v,t))) (starts ++ ends)
          starts = map (\x -> (Start, segmentStart x, x)) nonZero
          ends   = map (\x -> (End, segmentEnd x, x)) nonZero
          nonZero = filter (\s -> segmentStart s /= Vector2 0 0 && segmentEnd s /= Vector2 0 0) segments
