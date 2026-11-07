# 📣 Social Media Kit — TypeRacer 3D

Everything you need to post this and get eyes on it. Visual-first wins:
**lead with the video**, then screenshots. Post when EU/US morning + commute
time overlaps (≈ 14:00–18:00 UTC).

---

## 🎬 Assets

| File | Use |
|---|---|
| `media/gameplay-car.mp4` (~57s, 720p) | **X / Twitter video** — night street race: comeback duel for gold, real hesitations + backspace-fixed typos. Upload natively (don't link) |
| `media/gameplay-horse.mp4` (~62s, 720p) | **X / Twitter video** #2 — wild west duel: early lead, mid-race falter, final-sprint gold |
| `media/gameplay-split.gif` (16s loop, tracked in git) | README embed, Discord, Reddit preview — car \| horse side by side |
| `public/og.jpg` (1200×630) | link preview card — also upload as the repo **Social preview** (Settings → Social preview) |
| `docs/screenshots/*.png` (10 shots) | follow-up tweets, threads, Discord |

**Tip:** X autoplay + mute → your first frame must look good. The night street
race with glowing headlights + combo flames is the strongest opener.

> The mp4s are local-only (git-ignored) so clones stay light — they're in your
> working copy after recording; the split GIF is the only tracked video.

**Tip:** X autoplay + mute → your first frame must look good. The night street
race with glowing headlights + combo flames is the strongest opener.

---

## 🐦 X / Twitter — English drafts

**Main post (with video):**

> I rebuilt [play.typeracer.com](https://play.typeracer.com) as a 3D racing game 🏎️
>
> Every race is a REAL historical TypeRacer race — real quote, real opponents,
> and the bots replay those humans' exact keystroke timing. Not simuated. Replayed.
>
> 4 themes: cars, boats, horses, rockets 🚀
> Free & open source 👇
> https://github.com/Lakzayi/typeracer3d
>
> #gamedev #threejs #javascript #webgl #indiedev

**Follow-up (the hook most people miss):**

> The wild part: TypeRacer result pages expose the winner's typing log —
> millisecond timing of every keystroke.
>
> So my "bots" are real humans, resurrected keystroke-for-keystroke.
> You can literally race a ghost of a stranger from 2019. 👻⌨️
>
> #javascript #threejs

**Follow-up 2 (features):**

> - realistic mode: typos STICK, fix with backspace ⌨️
> - combo streaks set your exhaust on fire 🔥
> - rearview mirror when you're winning 🪞
> - day / sunset / night in every theme 🌗
> - top-down minimap, zero dependencies
>
> https://github.com/Lakzayi/typeracer3d

**Short & punchy alternative:**

> "typing test but make it Mario Kart" 🏎️💨
>
> real TypeRacer races → 3D world
> open source, zero dependencies
>
> https://github.com/Lakzayi/typeracer3d
> #threejs #webgl #gamedev

---

## 🐦 X / Twitter — پیش‌نویس فارسی

**پست اصلی (با ویدیو):**

> تایپ‌ریسر رو به یه بازی مسابقه‌ای سه‌بعدی تبدیل کردم 🏁
>
> هر مسابقه، یه مسابقه‌ی واقعیِ تاریخچه‌ی TypeRacer هست — متن واقعی، حریف‌های واقعی،
> و ربات‌ها تایم دقیق میلی‌ثانیه‌ای تایپ اون آدم‌های واقعی رو بازپخش می‌کنن!
>
> ۴ تم: ماشین، قایق، اسب، موشک 🚀
> رایگان و متن‌باز 👇
> https://github.com/Lakzayi/typeracer3d
>
> #گیم_سازی #جاوااسکریپت #برنامه_نویسی

**پست دوم (نکته‌ی جالب):**

> نکته‌ی باحالش اینه: صفحات نتیجه‌ی TypeRacer لاگ تایپ برنده رو دارن —
> یعنی تایم دقیق هر کلید. ربات‌های من همون آدم‌های واقعی هستن که
> کلید-به-کلید بازپخش می‌شن. داری با روح یه غریبه‌ی سال ۲۰۱۹ مسابقه می‌دی 👻
>
> https://github.com/Lakzayi/typeracer3d

---

## 📱 Other channels

- **Reddit:** r/WebGames, r/IndieGaming, r/javascript, r/threejs — lead with the
  GIF, one-line title: *"I turned TypeRacer into a 3D racing game — bots replay
  real humans' keystroke timing"* + note it's open source.
- **Hacker News:** title: *"Show HN: TypeRacer as a 3D racing game (real race
  replays, zero dependencies)"* — mention the read-only/ToS-respecting data
  approach in the first comment yourself.
- **Discord communities:** typing/dev servers — GIF + link works best.

## 🏷 Hashtag sets

- EN core: `#gamedev #threejs #webgl #javascript #indiedev`
- EN extra: `#buildinpublic #typing #opensource #screenshotaturday`
- FA: `#برنامه_نویسی #جاوااسکریپت #گیم_سازی`

## ✅ Posting checklist

1. Push to GitHub first — the link is the call-to-action.
2. Repo polish: description ("TypeRacer as a 3D racing game — bots replay real
   humans' keystroke timing"), topics (`threejs`, `typing-game`, `gamedev`,
   `webgl`, `typeracer`), and upload `public/og.jpg` as the **Social preview**.
3. Upload `gameplay-car.mp4` **natively** on X (native video gets ~10× reach vs links).
4. Pin the main tweet; reply with the screenshots thread.
5. Put the GIF at the very top of the README (it renders inline on github.com).
6. In replies, show the **challenge mechanic**: "finish a race, hit share/challenge,
   and the link makes your friend replay your EXACT race against the same ghosts."
   That loop (every finisher recruits challengers) is the growth engine.
7. After GitHub Pages is live, switch the `og:url` / `og:image` / `twitter:image`
   meta tags in `public/index.html` to absolute `https://<you>.github.io/<repo>/…`
   URLs so X renders the big image card.
