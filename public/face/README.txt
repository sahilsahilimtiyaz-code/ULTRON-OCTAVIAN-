DROP-IN FACE ASSETS
===================

OPTION 1 — AI VIDEO CLIPS (best looking)
----------------------------------------
Folder: public/face/clips/
Files (all optional, any you skip falls back):
  idle.mp4      breathing / looking around     4-8s seamless loop
  listening.mp4 leaning in, alert              3-6s loop
  thinking.mp4  eyes darting / scanning        3-6s loop
  talking.mp4   mouth moving, talking          3-6s loop
  working.mp4   working / coding expression    3-6s loop
  success.mp4   satisfied nod                  2-3s
  error.mp4     angry / glitch                 2-3s

Specs: 720p max, MP4 (H.264), 24fps, black background, under ~4MB each.
Tip: generate ONE great head image first, then use image-to-video from that
same image for every clip so identity and lighting stay consistent.

OPTION 2 — SINGLE HEAD IMAGE (layered puppet)
---------------------------------------------
File: head.png (or head.jpg / head.webp / head.svg)
Front-facing head, black/dark background, 800-1600px wide.
The jaw region is cropped and slides down while talking; the eye region
blinks and glows per state.

Fine-tune the crops with regions.json (fractions of the image, 0..1):
{
  "face": { "x": 0.04, "y": 0.02, "w": 0.92, "h": 0.97 },
  "jaw":  { "x": 0.30, "y": 0.636, "w": 0.44, "h": 0.15 },
  "eyes": { "x": 0.28, "y": 0.395, "w": 0.44, "h": 0.06 },
  "jawDropFrac": 0.042
}

FALLBACK CHAIN
--------------
clips present? -> video states
else head image? -> layered puppet (crop animation)
else -> original procedural 3D head (built in)

IMPORTANT: use only art you own or have rights to. The built-in head is
original procedural/vector artwork created for this project.
