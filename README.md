# BIRDS Flight Lab: CoDrone EDU simulator

A browser-based simulator for junior secondary students programming **CoDrone EDU** drones.
Students build a flight program with Robolink-style blocks, right in the app, or import one
exported from [Robolink Blockly](https://codrone.robolink.com/edu/blockly/). They press **Run**
to watch the expected flight through a 3D course that matches the one laid out in class. Once the
simulation passes, they can plug in the drone's controller with USB and **fly the same program on
the real drone** (see [Flying the real drone](#flying-the-real-drone)).

> The simulator shows the *expected* movement of a program. Wind, battery, sensors and real physics
> are not modelled, so the real flight can drift from it.

The flight is shown in 3D, which needs a browser with WebGL. Without WebGL, the page explains the
problem, and the editor, flight plan, telemetry and mission result still work.

## Block editor

The editor (`src/components/BlocklyEditor.tsx`) is [Google Blockly](https://developers.google.com/blockly),
the engine Robolink Blockly is built on. The five supported blocks (`src/blocks/robolinkBlocks.ts`)
use **exactly** Robolink's block types, field names and number "shadow" types, so:

- **Import:** a Robolink `.xml` file opens in the editor and can be changed there. You can drop it
  on the editor or use the Import button.
- **Download:** saves the program as Robolink XML, ready to open in Robolink Blockly and fly.
- **Checking:** every edit is turned into XML and checked by the same parser as an imported file.
  The flight plan, problem list and Run button update live. **Show block** jumps to the block a
  problem refers to.
- **During a run:** the block being flown gets a yellow outline. If the flight fails, the failing
  block gets a warning badge.
- **Saving:** the program is kept in the browser (`localStorage`), so a reload does not lose
  work. **New** starts from *take off → land*, which is also what a first visit opens with.
  **Example** loads the solution for the course that's selected.

The palette is a slim category rail: Flight (take off, hover, land), Move (go forward /
backward / left / right) and Turn. Clicking a category slides out its blocks, and the drawer
closes once a block is dragged out, so the full width stays free for building. On narrow screens
the rail runs along the top.

Dragging is tuned to feel steady:

- Dragging a block out of a stack moves **just that block**, and the blocks below close the gap.
  Hold **⌘** (Mac) or **Ctrl** (Windows) while dragging to move a block together with every block
  below it. (This is the reverse of Blockly's default. On a Mac, Ctrl+click opens the context menu,
  so use ⌘ or Option.)

- No grid snapping, so blocks glide instead of jumping in steps.
- A wider connection snap radius (48–64 px) makes stacking forgiving.
- A strong preference for the current connection stops blocks flickering between two nearby
  spots.
- The program is only re-checked after a block is dropped, never halfway through a drag. Blockly's icons and
cursors are served from `public/blockly-media/` rather than Blockly's CDN, so the editor works
offline. `src/tests/blocks.test.ts` checks that a real Robolink export loads into Blockly and saves
back to the same program with the same block IDs.

## Running it

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest unit + integration tests
npm run typecheck  # strict TypeScript
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

No backend is needed; `dist/` is a static site.

## Flying the real drone

Works in Chrome, Edge and Brave on a computer (it uses the [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API)).
Other browsers explain this and still offer **Download**. There is still no backend: the page talks
to the CoDrone EDU controller over USB directly, like Robolink Blockly does.

1. Plug the controller in, turn the drone on, and press **Connect drone** in the *Real drone* panel.
   The browser asks which device to use. Pick the controller ("STM32 Virtual ComPort"). Only one
   tab or program can use it at a time, so close Robolink Blockly first.
2. **Fly real drone** is enabled only when:
   - the simulator says *Mission complete* for this program and course,
   - the drone answers, is on the ground and ready, and has at least 30% battery,
   - the program starts with take off and no single move is longer than 500 cm.

   Otherwise the panel lists what's missing.
3. A safety checklist comes next (area clear, drone on its start mark). Then **Fly now**.
4. While flying, the block being flown is highlighted in the editor and the flight plan.
   - **Land now** lands gently.
   - **STOP**, or the **Space** key, cuts the motors at once.
   - The drone also lands by itself if a step times out, the drone stops answering, the battery
     reads below 15% for 3 seconds, or the tab is hidden or closed.
   - Short radio dropouts are ridden out where it's safe: a flight waits up to 2 s for the drone
     to answer before refusing to start; landing keeps sending "land" for up to 10 s, waiting for
     the drone to confirm; position and heading readings taken while the drone is still wait up to
     1.2 s. A dropout mid-flight still stops the flight after 1.5 s.
   - **If the radio link is lost, the drone lands by itself.** At the start of every flight the app
     sets the drone's own lost-link behaviour: stop moving after 0.6 s, land after 3 s (its
     default was to land only after 20 s, so it just hovered), and stop the motors after 120 s.
     The app also keeps sending "land" for up to 30 s after losing contact, and shows a warning
     to press STOP if the drone doesn't come down.

**Code** (`src/hardware/`):

| File | What it does |
|---|---|
| `protocol.ts` | The CoDrone EDU packet format (`0A 55`, header, payload, CRC-16/XMODEM), packet builders and an incremental decoder. Pure, unit-tested against golden bytes. |
| `SerialLink.ts` | Opens the controller at 57600 baud (USB vendor `0x0483`) and turns the byte stream into packets. |
| `DroneRunner.ts` | Flies a `DroneCommand[]`, the same list the simulator checks: one command at a time, each confirmed by the drone's reported state. Also does the preflight checks and the land/stop paths. |
| `useRealDrone.ts` | React hook: connection, live status and battery, the flight, the Space key and leaving the page. |

Timings and control loops follow Robolink's open-source `codrone-edu` Python library (v2.11):
- **Moves:** relative position moves at 0.5 m/s.
- **Turns:** a yaw feedback loop that reads the drone's heading.

**Measured on the hardware:** the controller holds only **one** unanswered request at a time, and
a newer request replaces it. So status polling pauses during turns, and heading requests are resent
until answered. Also, right after a turn the drone keeps reporting "Moving" while it steadies,
and a move sent then can be skipped. So each move first waits for a fresh "Hovering", then resends
until the drone reports "Moving". The drone's position is read before and after each move, and the
log shows how far it really went. Turns are flown by the drone's own heading control: one position
command with a heading change. The yaw-stick feedback loop from `codrone-edu` also works and is
kept as an option, but it depends on a fast stream of heading replies. Either way, turns ended 2–9°
past their target (more on a full battery). So the runner:
- learns that overshoot as it flies, and aims each turn short by its estimate. The estimate is
  kept between flights while the drone is connected;
- tracks where the program says the drone should face, and aims each turn at that heading. A small
  error is corrected on the next turn instead of adding up.

Moves also stop a little short (50 cm moves logged 46–51 cm, and moves after a turn were 5–25%
short). The runner learns the ratio of distance travelled to distance sent, and asks for that much
more, up to +30% (for example, it sends 53 cm for a 50 cm block). It learns from moves of 20 cm or
more, ignores outliers, and keeps the estimate between flights while connected. The fake drone in
`src/tests/fakeDrone.ts` behaves the same way.

**Calibration.** What the runner learns (turn overshoot and distance ratio) is saved in the
browser, so it survives reconnecting and reloading, and the app and the hardware test page share it.
It's saved per browser, not per drone: use **Reset calibration** on the test page when you switch
drones. Before each landing, the runner also measures how far the drone is from where the program
says it should be (the **end point**). That's the overall accuracy number for a flight.

**Straight lines and the planned point.** Each move aims at the point the program says the drone
should reach, not just "asked cm from wherever it is". So drift while hovering and earlier errors
are made up within the move, capped at 10 cm so a bad position reading can't send it far off
(`aiming at the planned point: 2 cm further, 5 cm left`). The move is turned into the drone's own
frame using its measured heading, so a nose left a few degrees off by a turn still follows the line.
During each move the runner samples the drone's position every ~100 ms and reports the largest
sideways distance from the line. Every 4th sample is a status request instead, so the safety
checks keep running. Distances are learned as two ratios: one for ordinary moves, and one for moves
straight after a turn, which fell about 10% shorter on hardware.

**Hardware test page.** `npm run dev`, then open `/spike/hardware.html`. **Flight School calibration**
has a button for each lesson. Fly each one several times, putting the drone back on the start mark
in between. The **Results** table summarises every flight: moves (distance flown vs asked), turn
error, how far off course the turns left the drone, and the end point. **Copy results** copies a
compact text summary; results are kept in the browser until **Clear results**. It flies small test
programs (single moves, single turns, a U-turn with a 40 cm sideways step) or pasted Blockly XML, and shows raw
state and packet logs. It is not part of the production build.

## How a program flows through the app

```
blocks / .xml file ─► RobolinkXmlParser ─► CommandMapper ─► DroneCommand[] ─► SimulationEngine ─► SimulationResult
              (DOM, limits)        (validation)     (preview list)    (authoritative)        │
                                                                                            ▼
                                    Maze3DViewport / Telemetry ◄── useSimulation ◄── animation/timeline
```

1. **Parse** (`src/parser/`). `RobolinkXmlParser` reads the file with the browser `DOMParser`, matching
   elements by local name in the Blockly namespace. It does not use regular expressions on the XML,
   and nothing in the file is ever executed. It walks the `<next>` chain and collects raw blocks.
   `CommandMapper` turns each block into a typed `DroneCommand`, keeping the Blockly block `id`.
2. **Simulate** (`src/engine/`). `SimulationEngine` applies the commands to an authoritative
   `DroneState`, with swept collision checks, and stops at the first failure. It is pure TypeScript
   and deterministic, with no React code.
3. **Animate** (`src/animation/timeline.ts`, `src/hooks/useSimulation.ts`). The finished result is
   turned into a timeline of poses, and playback only moves a clock through that timeline. Animation
   can never change an outcome.

## 3D view

`src/three/` renders the mission with [three.js](https://threejs.org). The code is loaded lazily,
so the rest of the page appears quickly, and a message is shown if WebGL is unavailable or fails to
start.

- **Scenes:** pick *Classroom* (the default) or *Forest*.
  - **Classroom:** a room built around the arena, with 30 cm vinyl floor tiles, painted walls,
    sunny windows, a whiteboard, a door, a clock, ceiling light panels, and desks pushed back
    against the walls. The course is laid out the way a class would build it. Obstacles are
    stacks of cardboard boxes at their real measured size (about 40 cm per box). The arena edge,
    landing pad, start mark and red zones are floor tape. Traffic cones mark the arena corners,
    the corners of the red zones and the checkpoints. A "0,0" label marks the corner that all
    measurements start from.
  - **Forest:** the outdoor field from before, with sky, clouds, trees, a netted cage, crates and
    concrete walls.
  - Every texture is drawn in code, so there are no image assets.
- **The drone:** a quadcopter about the size of a CoDrone EDU, with prop guards, spinning
  propellers and motion-blur discs. A red LED and nose marks the front; a green LED marks the
  back.
- **Realistic motion (visual only):** the drone climbs to the chosen flight height on takeoff. Moves ease in
  and out (smootherstep). The drone tilts into its acceleration, nose-down when speeding up,
  nose-up when braking, and it rolls when strafing. It bobs gently while hovering. Propellers spin
  up and down. After a collision it loses lift and falls under gravity. These effects come from
  pure functions in `src/three/motion.ts`, which read the timeline. **They never change where the
  drone goes or whether the mission succeeds.**
- **Run:** pressing Run puts the drone back on its start mark and glides the camera to it in
  *Follow drone* view (leaving measuring mode if it was on). The flight starts about a second
  later, once the camera has arrived.
- **Camera controls:** drag sensitivity is about half the three.js default, with inertia that
  settles quickly. The camera pad in the corner of the view, and the arrow / + / − / 0 keys when
  the view has focus, rotate, tilt, zoom and re-centre in smooth steps. The follow camera takes
  about 0.8 s to swing round after the drone turns, and the drone itself turns at 75°/s.
- **Cameras:** *Overview* (drag to orbit, scroll to zoom), *Follow drone* and *Top-down*.
  They move like a game camera. Your drags move an invisible "proxy" camera, and the real camera
  follows it on critically damped springs (`smoothDamp` in `src/three/cameraView.ts`). That
  gives smooth glides between modes, a slight lag behind the drone, easing round turns, a slight
  look-ahead in the direction of travel, and a small shake on a crash. Indoors, the overview and follow
  cameras stay inside the room. Top-down looks in through a cut-away ceiling, with the 0,0 corner
  at the top-left, like a floor plan.
  The follow camera rides with the drone and turns when it turns. *View from* swings it smoothly
  to **Behind**, the **Right side**, the **Left side** or the **Front** of the drone (side views
  show the tilt and speed best). Dragging rotates the camera freely around the drone, and the angle
  you choose is kept as the drone turns. If the net, a box or a room wall would block the view,
  the camera pulls in along its line of sight at once and eases back out once the way is clear,
  like a game "spring arm". Cones, posts and flag poles directly in front of the drone fade out.
- **Measuring tool:** pressing **Measure** switches to a top-down floor plan (drag to pan, scroll
  to zoom towards the pointer) and returns to the previous camera afterwards.
  - Every snappable point (arena, box and pad corners, pad centres, the start mark, red-zone
    corners and cones) is shown as a dot.
  - Points snap from up to 18 px away on screen, so they are equally easy to hit at any zoom.
    Anywhere else, points round to whole centimetres.
  - After the first click, a rubber-band tape follows the pointer with a live distance. Dashed
    legs show the across (x) and along (y) parts.
  - The readout under the view gives the distance from the 0,0 corner, so students can lay the
    course out with a tape measure. **Clear** or Esc starts again.
  - The maths is in `src/three/measure.ts`.
- **Performance:** if frames stay slow (under about 22 fps), the render resolution drops step by
  step, down to half. Leaving the 3D view releases its GPU context.

### Flight height and real block heights

Phase 1 has no altitude commands, so after takeoff the drone holds one height. Robolink does not
publish a fixed takeoff height, so the **Flight height** setting (40–150 cm, default 80 cm) should
be set to what your drones actually do. Measure it once with a tape measure.

- A box **taller than flight height − 10 cm** blocks the drone. The 10 cm covers the drone's body
  and its hover wobble (`OBSTACLE_CLEARANCE_CM`). Lower boxes are flown over. For example, at
  80 cm the drone clears a single 40 cm box but hits an 80 cm stack.
- The drone can never **land** on top of a box, whatever its height.
- Red no-fly zones count at every height.

The real CoDrone EDU holds its height above whatever surface is **below** it, using a downward
range sensor, so it rises over a box. The simulator keeps the height above the floor instead. In
the classroom, keep boxes well below the flight height or well above it, rather than close to it.

Random wind or drift is intentionally **not** simulated. With it, a correct program could fail at
random, which would hide the programming lesson. A seeded "real-world wobble" mode could be added
later to show why real flights differ from the plan.

## Supported Blockly blocks (Phase 1)

These were confirmed from a real Robolink export (`src/tests/fixtures/main.xml`):

| Block type               | Fields / inputs                                                | Command                 |
| ------------------------ | -------------------------------------------------------------- | ----------------------- |
| `takeoff`                | —                                                              | `TAKEOFF`               |
| `land`                   | —                                                              | `LAND`                  |
| `hover`                  | `NUM0` (seconds, 0–300)                                        | `HOVER`                 |
| `go_distance`            | `TYPE` = `Direction.FORWARD/BACKWARD/LEFT/RIGHT`, `UNIT` = `cm`, `NUM0` (0–10000) | `MOVE` |
| `turn_direction_degrees` | `TYPE` = `Direction.LEFT/RIGHT`, `NUM0` (0–360)                | `TURN`                  |

Numeric inputs are read from the `<shadow>` default unless a real `<block>` is connected, in which
case the connected block wins. Connected blocks must be plain number literals
(`math_number`, `only_positive_decimal`, `only_positive_decimal_50`, `limit_0_To_360`). Anything
else, such as arithmetic or variables, is reported as an **unsupported expression**. The parser
never quietly falls back to the shadow value.

The parser rejects, and reports with the block ID: malformed XML, DOCTYPEs, unsupported blocks,
disabled blocks, loops, other nested statements and mutations, variables, missing fields, invalid
or out-of-range numbers, unknown units or directions, and multiple loose block stacks. Limits:
256 KB file size, 5,000 XML elements, 500 program blocks.

A program in the wrong order (moving before takeoff, never landing, taking off twice) still
imports, but with **warnings**, so students can watch where it fails.

## Simulation rules

- Units are centimetres. The origin is at the top-left, +x is right and +y is down.
  Heading 0° is up and 90° is right; turning right increases the heading.
- Moves are relative to the drone's heading. Left and right moves strafe sideways without turning.
- The drone is a circle (`droneRadiusCm`). Obstacles and no-fly zones are axis-aligned rectangles.
  A move is rejected if the circle overlaps any of them **at any point along the path**. This is
  an exact segment-to-rectangle distance test, so the drone cannot tunnel through a thin wall.
  Touching an edge exactly is allowed.
- The circle must stay fully inside the arena.
- A rejected command leaves the previous state untouched and ends the run. The failure records the
  command index, the Blockly block ID, the hazard ID, and the contact point, which is used only for
  drawing.
- Landing on top of a box, or on a cone (checkpoint cones and the arena corner cones, 18 cm bases),
  fails at the Land block. Cones are markers to fly over, but a drone coming down on one can tip
  over or break a propeller.
- The mission succeeds when every command runs, the drone ends **landed**, its centre is inside
  the landing zone, and every checkpoint was passed within its radius.

## Courses

The **Course** picker has three groups. Every course is laid out in the same 4 × 3 m taped arena,
and each has an **Example** solution:

| Group | Course | Students practise |
|---|---|---|
| Flight School | Lesson 1: First flight | take off, hover 2 s, forward 50 cm, land on the pad |
| | Lesson 2: Turn right | …forward 50 cm to a cone, turn right 90°, forward 50 cm (a box stack blocks going straight on) |
| | Lesson 3: Turn left | the same, turning left |
| | Lesson 4: The square | a 50 cm square, turning right at each corner, back onto the start pad |
| | Lesson 5: Figure eight | one square clockwise (right turns), then one anticlockwise (left turns) |
| Maze challenges | Maze 1: Zig-zag | start mark to finish pad between two box walls: right, right, left |
| | Maze 2: Snake | a longer route: left, left, right, right |
| Free flight | Open floor | no goal: practise anything, land back on the pad |

The layouts follow what flight tests with a real CoDrone EDU showed (`src/mazes/courseRules.ts`):
- moves are multiples of 50 cm, the most tested distance;
- landing pads are 50 × 50 cm, plenty for the drone's ±5 cm per move;
- the route stays at least **40 cm** from every box wall and from the arena edge. That covers
  about 8 cm of drone radius, up to about 15 cm of drift over a course, and a margin.

`src/tests/courses.test.ts` checks every course: it is valid, its Example completes it while keeping
the 40 cm clearance, and "take off, land" alone can't pass it.

Playback starts at **0.5×**, which looks closest to the real drone flying the same program.

## Adding a course

1. Create a `MazeDefinition` in `src/mazes/` (see `src/mazes/types.ts`), with an `exampleXml` solution
   (`programXml([...])` builds one), and follow the sizes in `src/mazes/courseRules.ts`.
   Measure the real course and use the same numbers: positions are from the 0,0 corner, and each
   obstacle's `heightCm` is its real height (default 120 cm). In the classroom scene, obstacles
   are drawn as stacks of 40 cm cardboard boxes. In the forest, narrow ones are concrete walls
   and square ones are wooden crates.
2. Add it to a group in `COURSE_GROUPS` in `src/mazes/index.ts`. It appears in the course picker
   automatically.
3. Run `npm test`. The suite runs `validateMaze` and the course checks above on every course. This
   catches a start inside an obstacle, shapes outside the arena, duplicate IDs, checkpoints inside
   walls, a route too close to a wall, and similar mistakes.

## Adding a Blockly block

1. Export a real program that uses the block from Robolink Blockly and add it under
   `src/tests/fixtures/`. Don't guess the XML.
2. Add a variant to `DroneCommand` in `src/parser/types.ts` if needed.
3. Add a `BlockSpec` entry in `src/parser/CommandMapper.ts` that lists the allowed fields and value
   inputs and how to map them.
4. Handle the command in `SimulationEngine.execute`, `buildTimeline` and `describeCommand`.
   TypeScript's exhaustive `switch` statements will point out the places you miss.
5. Add parser and simulation tests.

Loops, conditions, variables, sensors and functions are deliberately unsupported until
representative exported XML is available.

## Project layout

```
src/
├── app/App.tsx                 page composition and import state
├── blocks/                     Robolink block definitions, palette, Blockly theme
├── components/                 BlocklyEditor, ProgramPanel, FlightPlan, Maze3DViewport, FlightHud,
│                               TransportBar, MissionFeedback, Icon
├── parser/                     RobolinkXmlParser, CommandMapper, SequenceValidator, describeCommand, types
├── engine/                     SimulationEngine, MovementEngine, CollisionDetector, types
├── animation/timeline.ts       result → poses over time (visual only)
├── three/                      3D world: createDroneWorld (render loop, camera rig, measuring),
│                               scenery (classroom / forest environment), mazeObjects (props),
│                               droneModel, textures, motion, cameraView, measure, coords
├── hooks/useSimulation.ts      playback clock: run, pause, resume, reset, speed
├── mazes/                      maze data, registry and validateMaze
└── tests/                      Vitest suites + fixtures/main.xml
```

## Assumptions not verifiable from the single sample

- `Direction.BACKWARD`, `Direction.LEFT` and `Direction.RIGHT` for `go_distance`, and
  `Direction.LEFT` for turns, follow the naming pattern of the confirmed values.
- Only the `cm` unit is accepted. Other units Blockly may offer are rejected with a clear message
  until an export confirms their exact field values. To add one, extend `UNIT_TO_CM` in
  `CommandMapper.ts`.
- When a real block is plugged into an input, Blockly writes `<shadow>` and `<block>` side by side
  inside `<value>`. This is standard Blockly behaviour, but the sample only contains shadows.
- Robolink programs appear to be one top-level stack with no "start" hat block, as in the sample.
  Workspaces with several loose stacks are rejected as ambiguous.
- The landing check uses the drone's centre point, and no-fly zones are checked against the drone's
  full body.
- Playback speeds (40 cm/s, 75°/s turns, 1.2 s takeoff and landing at 1×) are only for display. At
  the default 0.5×, a program takes about as long as on a real CoDrone EDU.
