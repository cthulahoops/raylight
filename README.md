# raylight

This is experiment with a vibe coded game that isn't just slop. My goal was to hand-off
all the programming to the model, but not hand-off the game design.

It originates from a lighting demo I wrote 10 years ago.

2D ray-lighting experiment in the browser. `web/src/raylighting.ts` holds the
angular-sweep visibility algorithm; `web/src/renderer.ts` draws the result
with WebGL.

Run the dev server:

    cd web
    npm install
    npm run dev

`original/` holds the 2015 Haskell version this started from.
