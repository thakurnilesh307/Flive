---
title: Flive
emoji: ✈️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
short_description: Live arrivals with ML landing-time predictions
---

# Flive

Live air traffic at Boston Logan, New York JFK and London Heathrow, with machine-learning
predictions of when and on which runway each arriving flight will land.

- Live map: this Space's main page
- About: `/about.html`
- Results (time lost on arrival, scheduler comparison, transfer controller): `/results.html`

Source code: https://github.com/thakurnilesh307/Flive

Live positions come from adsb.fi; history from adsb.lol; the world view from the
OpenSky Network. The Space sleeps after about two days without visitors and takes a
minute to wake up; live tracking pauses while it sleeps.
