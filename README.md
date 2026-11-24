# XC Ski Motion Analyzer

A web tool for cross-country skiing technique analysis. Drop in a side-view video and it draws a skeleton on the skier, plots joint angles over time, and lets you download the angles as a CSV file and the annotated video as an MP4.

Everything runs in the browser. The video is never uploaded anywhere.

## How to use it

1. Open the page and drop a video onto it (MP4, MOV, or WebM).
2. Wait for the analysis to finish. The progress bar shows the time remaining.
3. Play or scrub the video. The charts follow along, and clicking a chart jumps to that moment. The left and right arrow keys step one frame at a time.
4. Download the results with the buttons under the video.

Film from the side, with the camera at about hip height and the whole body in the frame. The tool tracks one person.

## What it measures

Pose estimation uses [MediaPipe Pose](https://github.com/google-ai-edge/mediapipe) (BlazePose, 33 landmarks). Three model sizes are available: Fast, Balanced (default), and Accurate.

| Angle | Definition |
|---|---|
| Knee | Angle at the knee between hip and ankle |
| Hip | Angle at the hip between shoulder and knee |
| Ankle | Angle at the ankle between knee and toe |
| Elbow | Angle at the elbow between shoulder and wrist |
| Shoulder | Angle at the shoulder between elbow and hip |
| Trunk lean | Angle between the hip-to-shoulder line and vertical |

Joint angles are included angles, so 180° is a fully straight joint. Flexion is 180° minus the reported value. Trunk lean is 0° when upright. All angles are measured in the image plane (2D).

Landmark positions are smoothed with a zero-phase, second-order Butterworth low-pass filter (6 Hz by default, adjustable or off). The cutoff is in video time, so for slow-motion footage the effective cutoff in real time is higher.

## Output files

`<name>_angles.csv` has one row per frame: `frame`, `time_s`, `person_detected`, then an angle column (`knee_L_deg`, `knee_R_deg`, …, `trunk_deg`) and a confidence column (`knee_L_conf`, …) for each angle. Confidence is the lowest landmark visibility among the points used for that angle, from 0 to 1. Values below 0.5 are drawn faint in the charts.

`<name>_landmarks.csv` has the raw, unfiltered pixel position and visibility of all 33 landmarks for every frame, for anyone who wants to run their own analysis.

`<name>_annotated.mp4` is the video with the skeleton drawn on it. Browsers that cannot encode H.264 produce a `.webm` file instead. The exported video has no audio.

## Limitations

- These are 2D estimates from a single camera. They are not a substitute for laboratory motion capture.
- The arm and leg on the far side of the body are often hidden, so their angles are less reliable. Check the confidence values.
- In a side view the model can occasionally confuse the left and right limbs.
- Ski poles and skis are not tracked.
- Time is video time. For slow-motion footage, cadence and angular velocity need to be rescaled by the slow-motion factor.
- A moving camera does not affect joint angles, but the tool does not measure speed or stride length.

## Run it locally

The page needs to be served over HTTP (opening `index.html` directly will not work). From this folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000. There is no build step and no dependencies to install. The pose models and libraries are included in `vendor/`.

## Publish on GitHub Pages

Push this folder to a GitHub repository, then go to Settings, Pages, and choose "Deploy from a branch" with the `main` branch and the `/ (root)` folder. The site appears at `https://<user>.github.io/<repo>/` after a minute or two.

## Project layout

```
index.html          page markup
css/style.css       styles
js/app.js           user interface and analysis loop
js/analysis.js      filtering, angle math, CSV output (no DOM code)
js/draw.js          skeleton drawing
js/charts.js        angle charts
js/export.js        annotated video export
vendor/             MediaPipe Pose 0.5.1675469404 and Mediabunny 1.66.4
```

`js/analysis.js` has no browser dependencies, so the same angle definitions can be reused in a future mobile app.

## Licenses

The code in this repository is released under the MIT License (see `LICENSE`). MediaPipe is licensed under Apache 2.0 and Mediabunny under MPL 2.0. Their license texts are in the `vendor/` subfolders.
