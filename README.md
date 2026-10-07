# Cube Puzzle Finder

Fill a 3×3×3 cube with three four-cube pieces and three five-cube pieces.
Pieces can be turned but not mirrored, and solutions that differ only by
turning the whole cube count once.

**Web page:** https://alexeid.github.io/grants-cubes/ — pick pieces, see every
solution in 3D, pull the cube apart, or find puzzles by number of solutions.

## Command line

    cc -O3 -o cubes cubes.c
    ./cubes shapes                                     # the 32 shapes and their names
    ./cubes solve 225/245/441 245/641/631 655/661/333  # every solution of a filled cube's pieces
    ./cubes solve 4b 4d 4g 5l 5o 5t                    # ... or of named pieces
    ./cubes enumerate sets.tsv                         # solution count of every piece set
    ./cubes enumerate sets.txt                         # ... in the form the web page reads

A filled cube is three layers, top to bottom; each layer is its rows, back to
front, separated by `/`.

Seven four-cube and 25 five-cube shapes fit in the cube. Of the 80,500 sets of
six different pieces, 42,798 can be solved; 6,464 have exactly one solution and
the most any set has is 395. Allowing repeated pieces, 102,386 of 245,700 sets
can be solved, with up to 560 solutions.
