module Walls where

import System.Random
import Dungeon
import Data.List

xs |^| ys = sort $ (xs \\ ys) ++ (ys \\ xs)

groupSequences [] = []
groupSequences xs = this : groupSequences rest
    where (this, rest) = splitSequence xs

splitSequence (x:xs) = splitSequence' [x] xs
    where splitSequence' (x:xs) (y:ys) | y == x + 1 = splitSequence' (y:x:xs) ys
                                       | otherwise  = (reverse (x:xs), (y:ys))
          splitSequence' xs [] = (reverse xs, [])

column squares n = map snd $ filter ((== n).fst) squares
row squares n = map fst $ filter ((== n).snd) squares

withRow n (a,b) = ((a,n+1),(b,n+1))
withCol n (a,b) = ((n+1,a),(n+1,b))

sliceSegments slicer patcher squares n = map (patcher n)
                                       $ map (\xs -> (head xs, last xs + 1))
                                       $ groupSequences (before |^| after)
    where before   = slicer squares n
          after    = slicer squares (n + 1)

dungeonWalls :: Grid -> [((Int,Int),(Int,Int))]
dungeonWalls dungeon = concat $ down ++ across
    where sqs    = gridSquares $ dungeon
          down   = map (sliceSegments column withCol sqs) [0..(gridWidth dungeon + 1)]
          across = map (sliceSegments row withRow sqs) [0..(gridHeight dungeon + 1)]
