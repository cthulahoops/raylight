module Dungeon (Grid, generateDungeon, gridWidth, gridHeight, gridSquares) where

import Data.List hiding (insert, delete)
import System.Random
import qualified Data.Map.Strict as M
import Debug.Trace

type Vector = (Int, Int)
type Color  = Int

data Point = Point {x :: Int, y :: Int}
    deriving (Show, Eq, Ord)

padd (Point x y) (dx, dy) = Point (x + dx) (y + dy)

adjacent by p1 = map (padd p1) by

orthoganally = [(0,1), (0,-1), (1,0), (-1, 0)]
diagonally   = [(1,1),(-1,-1),(1,-1),(-1,1)]

isAdjacent p1 p2 = abs (x p1 - x p2) + abs (y p1 - y p2) == 1

data Size  = Size {width :: Int, height :: Int}
    deriving (Show, Eq)

data Grid = Grid {
    gridSize :: Size,
    gridData :: (M.Map Point Int)
} deriving (Show)

gridWidth  = width . gridSize
gridHeight = height . gridSize

newGrid size = Grid size M.empty

insert :: Grid -> Point -> Int -> Grid
insert grid p color = withGridData (M.insert p color) grid

delete :: Grid -> Point -> Grid
delete grid p = withGridData (M.delete p) grid

withGridData :: (M.Map Point Int -> M.Map Point Int) -> (Grid -> Grid)
withGridData f grid = grid { gridData = f (gridData grid) }

addRoom :: Grid -> Room -> Color -> Grid
addRoom grid room color = insertMany grid (roomPoints room) color

gridSquares = map pair . M.assocs . gridData
    where pair (p, c) = (x p, y p)

gridColors  = nub . sort . M.elems . gridData 

openness :: [Vector] -> Point -> Grid -> Int
openness by point grid = length $ neighbours by point grid

neighbours :: [Vector] -> Point -> Grid -> [Point]
neighbours by point grid = filter (not . isEmpty grid) (adjacent by point)

isEmpty grid point = Nothing == gridLookup grid point

gridLookup grid point = M.lookup point (gridData grid)

onGrid :: Point -> Grid -> Bool
onGrid point grid = (x point) > 0 && (x point < 79) && (y point > 0) && (y point < 79)

closedPoints :: Grid -> [Point]
closedPoints grid = filter (\p -> onGrid p grid && openness (orthoganally ++ diagonally) p grid == 0) $ allPoints grid

allPoints grid = do
    x <- [1..(width (gridSize grid) - 1)]
    y <- [1..(height (gridSize grid) - 1)]
    return $ Point x y

filledPoints = M.keys . gridData

insertMany :: Grid -> [Point] -> Color -> Grid
insertMany grid ps color = foldl' (\acc p -> insert acc p color) grid ps

mazeFill :: StdGen -> [(Point, Color)] -> Grid -> Grid
mazeFill g [] grid = grid
mazeFill g ((p,c):ps) grid = if isEmpty grid p && isClosed grid p 
                          then mazeFill g' (zip randAdj (repeat c) ++ ps) withP
                          else mazeFill g' ps grid
            where withP = insert grid p c
                  adj   = filter (\x -> onGrid x grid) (adjacent orthoganally p)
                  (randAdj, g') = shuffle g adj

shuffle :: (Ord a, RandomGen g) => g -> [a] -> ([a], g)
shuffle g xs = (map snd $ sort $ zip (randoms g1 :: [Int]) xs, g2)
    where (g1, g2) = split g

isClosed :: Grid -> Point -> Bool
isClosed grid p = (length orthNeighbours == 0 && length diagNeighbours == 0)
               || (length orthNeighbours == 1 && all (isAdjacent (head orthNeighbours)) diagNeighbours)
    where orthNeighbours = neighbours orthoganally p grid
          diagNeighbours = neighbours diagonally p grid

potentialDoors :: Grid -> [Point]
potentialDoors grid = filter (isPotentialDoor grid) (allPoints grid)

isPotentialDoor :: Grid -> Point -> Bool
isPotentialDoor grid p = isEmpty grid p && case orthNeighbours of
        [a,b] -> gridLookup grid a /= gridLookup grid b
        _ -> False
    where orthNeighbours = neighbours orthoganally p grid

isDeadEnd :: Grid -> Point -> Bool
isDeadEnd grid p = length (neighbours orthoganally p grid) == 1

deadEnds :: Grid -> [Point]
deadEnds grid = filter (isDeadEnd grid) (filledPoints grid)

addDoor :: Grid -> Point -> Grid
addDoor grid p = if isPotentialDoor grid p then floodFill (insert grid p color) b color else grid
    where [a,b]      = neighbours orthoganally p grid
          Just color = gridLookup grid a

floodFill :: Grid -> Point -> Color -> Grid
floodFill grid point color = floodFill' grid [point]
    where floodFill' grid []     = grid
          floodFill' grid (p:ps) = floodFill' (insert grid p color) (newPs grid p ++ ps)
          newPs g p = filter (\x -> gridLookup g x /= Just color) $ neighbours orthoganally p g
    
data Room = Room {
        roomPos :: Point,
        roomSize :: Size}
    deriving (Show, Eq)

intersects :: Room -> Room -> Bool
intersects room1 room2 = overlapsP 1 (xSide room1) (xSide room2) && overlapsP 1 (ySide room1) (ySide room2)

roomSquares room = do
    x <- [xMin room..xMax room]
    y <- [yMin room..yMax room]
    return (x,y)

roomPoints room = do
    x <- [xMin room..xMax room]
    y <- [yMin room..yMax room]
    return $ Point x y

xSide room = (xMin room, xMax room)
ySide room = (yMin room, yMax room)

xMin = x . roomPos
yMin = y . roomPos

xMax room = xMin room + width (roomSize room)
yMax room = yMin room + height (roomSize room)

overlapsP pad (a1, a2) (b1, b2) = (a1 + pad >= b1 && a1 - pad <= b2) || (b1 + pad >= a1 && b1 - pad <= a2)

instance Random Size where
    randomR (s1, s2) g = (Size w h, g'')
        where h1 = height s1
              w1 = width  s1
              h2 = height s2
              w2 = width  s2
              (w, g')  = randomR (w1, w2) g
              (h, g'') = randomR (h1, h2) g'
    random g = (Size w h, g'')
        where (w, g')  = random g
              (h, g'') = random g'

instance Random Point where
    randomR (s1, s2) g = (Point xr yr, g'')
        where x1 = x s1
              y1 = y  s1
              x2 = x s2
              y2 = y  s2
              (xr, g')  = randomR (x1, x2) g
              (yr, g'') = randomR (y1, y2) g'
    random g = (Point xr yr, g'')
        where (xr, g')  = random g
              (yr, g'') = random g

instance Random Room where
    randomR (r1, r2) g = (Room pos size, g'')
        where (pos,  g')  = randomR (roomPos r1, roomPos r2) g
              (size, g'') = randomR (roomSize r1, roomSize r2) g'
    random g = (Room pos size, g'')
        where (pos, g')   = random g
              (size, g'') = random g

rMin = Room (Point 1 1) (Size 3 3)
rMax size = Room (Point size size) (Size 10 10)

inside size room = xMax room < (size - 1) && yMax room < (size - 1)

filterOverlap rooms = foldr f [] rooms 
    where f room acc = if any (intersects room) acc then acc else (room:acc)

empty size = newGrid (Size size size)

randomRooms :: StdGen -> Int -> Int -> Grid
randomRooms g size tryRooms = foldl' (\acc (r, color) -> addRoom acc r color) (empty size) (zip rooms [1,3..])
    where rooms = filterOverlap $ filter (inside size) $ take tryRooms $ randomRs (rMin, rMax size) g

pruneDeadEnds :: Grid -> Grid
pruneDeadEnds grid = case deadEnds grid of
    [] -> grid
    xs -> pruneDeadEnds $ foldl' delete grid xs

addPassages :: StdGen -> Grid -> Grid 
addPassages g grid = mazeFill g' (zip ps [2,4..]) grid
     where (ps, g') = shuffle g $ closedPoints grid


addDoors g grid = foldl' addDoor grid doors
    where (doors, g') = shuffle g $ potentialDoors grid

generateDungeon g size tryRooms = id $ pruneDeadEnds $ addDoors g1 $ addPassages g1 $ randomRooms g2 size tryRooms
    where (g1, g2) = split g

{-
main = do
    [count] <- getArgs

    g <- newStdGen
    let (g1, g2) = split g

    let grid = id 
             $ pruneDeadEnds
             $ addDoors g1
             $ addPassages g1
             $ randomRooms g2 (read count)
   
    draw $ gridSquares grid
-}
