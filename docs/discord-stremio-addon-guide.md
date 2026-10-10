# Pictorium as a Stremio addon — setup guide

## 1. What this guide does (Pictorium inside Stremio)

This guide shows how to use **Pictorium as its own Stremio addon**: custom
posters, ratings and quality badges, plus optional Pictorium catalog rows,
directly inside Stremio. No server setup needed — you use a hosted Pictorium
website and install it in Stremio like any other addon.

What you need, in short: a Stremio account you can install addons into, one
of the public Pictorium hosts below, and a free TMDB key you paste into
Pictorium (not into Stremio). The sections below walk through each step.

## 2. Pick a host and create your personal space

Open one of these verified public Pictorium instances (also listed in the
Pictorium README):

- https://pictorium.duckdns.org (community VPS)
- https://pictorium.elfhosted.com/ (ElfHosted)

You do not need to download or run anything yourself. On a shared public
host, create your **own personal space**: you pick a password and receive a
**recovery key**. Save that recovery key somewhere safe — it is shown only
once, and it is your way back if you forget the password.

Bookmark your space URL. It looks like this (placeholder, yours will differ):

```
https://<host>/u/<your-space-uuid>/configure
```

Always return through that bookmark so you edit *your* settings, not someone
else's. Anyone holding your editor link plus your space password can open
your editor, so treat the link like a login page: never post it publicly and
never paste passwords or recovery keys into Stremio, chats, or screenshots.

## 3. Add your TMDB key (free, 2 minutes)

Pictorium reads movie and series info from TMDB, so it needs a TMDB key from
you. Sign up free at `themoviedb.org`, then open **Settings → API** there
and copy the **API Key (v3 auth)** (a long string of letters and numbers).

Back in your Pictorium space, open **Settings** and find the **Your API keys**
section. Paste the key into **Personal TMDB Key**, save, and wait for the
**Keys saved.** confirmation (use **Verify key** where offered to double
check it).

If search later says **Enter a TMDB key in Settings to search**, or a poster
fails with an explicit key error, come back to this screen. The usual cause
is editing the wrong space (not your bookmark), an unsaved key, or a
rejected key — re-paste, save, and re-test one poster. IMDb and TMDB ratings
work with no extra keys; extra sources (Rotten Tomatoes, Letterboxd,
Metacritic, Trakt) need the optional MDBList key.

Privacy note: your keys belong to your space and power its catalogs, posters
and editor — Stremio never needs them. Never paste keys into Stremio, and
never share copied links or exported files that contain a raw `api_key`
value. Keep backups on your own device only.

## 4. Set your global poster style first

Do styling in two passes: global defaults first, then individual titles.
Global defaults apply to new and never-saved titles; titles you customize
later keep their own overrides.

1. In your space, open **Settings**.
2. Find the global styling controls (the defaults screen shows a **Global
   preview** sample poster, with **Quick setups** such as Essential, Ratings
   and Full plus style presets — pick the closest base).
3. Adjust badge style, rating sources, ranking style, network logo, gradient
   and blur to taste.
4. Press **Save as defaults** (and **Save** where the screen offers it) and
   wait for the saved confirmation.

That is your house style. Everything you do not override per title follows
these defaults.

## 5. Global default shape: portrait or landscape (Settings)

Pictorium posters come in two shapes: **Portrait** (classic vertical poster,
the safe universal choice — Stremio grids and detail pages overwhelmingly
show portrait) and **Landscape** (wide 16:9 backdrop-style cards with
baked-in logo, for titles and views you have checked on your own devices).

To change the **global default** shape for new titles:

1. In your space, open **Settings**.
2. Open the **Preferences** tab.
3. Find the **Poster Style** section and its **Poster shape** row.
4. Tap **Landscape** (or **Portrait** to go back).
5. Save / confirm if the screen offers it, and wait for the saved state
   before leaving.

One caution, stated plainly: in the Settings screens there is a **Format to
edit** switch (Portrait / Landscape). That switch alone only changes which
format you are previewing and tuning — it does not by itself re-deliver
already-saved titles. To actually change what Stremio receives for a title,
set the shape on that title in its editor and press **Save Poster** (see
Section 6). In landscape, note two real behaviors: the full-width ratings bar is
off (pills are used instead — portrait keeps the bar), and landscape blur
values you set win over portrait ones while anything unset follows portrait.

## 6. Customize one title and save it

1. From your space home, search for a movie or series.
2. The editor shows a live WYSIWYG preview: the image you see is what Stremio
   will receive for that title.
3. Adjust badges (genre, year, rating, streaming quality), ranking ribbons,
   network logo, gradient height, blur and language to taste.
4. To deliver this title in a specific shape, set its own **Poster shape**
   toggle to **Portrait** or **Landscape** in the title editor (separate from
   the global default in the previous section; use **Set as landscape** / **Set
   as portrait** where the editor offers that action).
5. Press **Save Poster** to keep the full styling for this title, and check
   the result under **My Posters** — your personal library of saved posters,
   where you can re-edit or delete any tile later.

Note: **Save poster only** (where offered) keeps just the chosen artwork and
logo for the title while letting badges, effects and all other styling follow
your global defaults — it clears previously saved custom styling. For the
plain Stremio addon in this guide you do not need to copy poster links at
all: the addon manifest carries your space, and saved posters apply
automatically.

## 7. Install Pictorium in Stremio (Install Hub)

Install from a **desktop or mobile browser** on a device where Stremio is
installed, or via **Stremio Web** while logged into the same Stremio account
you use on TV. The addon then syncs to your other logged-in devices through
your account (that sync is how it reaches TV — do not try installing inside
the TV app directly).

1. In your Pictorium space, press **Install Hub** (shown as **Install
   Pictorium Hub** in some views). A dialog titled **Connect Pictorium**
   opens.
2. Stay on the **Stremio** tab.
3. Pick what to include: **Full** (*Catalogs + Search*, the complete setup —
   start here), **Catalogs** (*Rows & Sections*, only catalog rows), or
   **Search** (*Search Bar*, only the poster search entry). Reinstall with a
   different mode to change it later.
4. Choose one install path: **Install in Stremio** (main button — fastest, on
   a device with the Stremio app installed), **Copy link** (paste the manifest
   URL into Stremio's addon URL field — pasting an `https://` link into a
   plain browser bar does not reliably install it), **Open Stremio Web**
   (prefills the install while logged in), or **Install on another device**
   (shows a QR code labeled **Scan from Smart TV or Smartphone** — reliably,
   scan it with your phone and let account sync carry the addon to TV).
5. Confirm Pictorium appears under Stremio **Addons → Installed**.

Your install link looks like this (placeholder, not a real link):

```
https://<host>/u/<your-space-uuid>/manifest.json
```

(The `?mode=` suffix records the Full / Catalogs / Search choice.)

## 8. What you get, caching, and quick fixes

What you get: Pictorium is a **standalone addon** delivering rich cards with
synopses, logos, backdrops, trailers and full seasons for supported titles.
Your saved posters replace default artwork wherever the Pictorium addon
provides the card (its catalog rows and search results). It does not reskin
your whole library: other addons keep working exactly as before.

Source addons stay: imported custom catalogs **do not replace the original
addon**. Source order, IDs and navigation are preserved; Pictorium artwork
applies to supported IMDb/TMDB titles while other items keep their original
images. If a catalog uses proprietary IDs, keep the source addon installed —
Pictorium does not forward its detail pages for those items.

Caching caveat: saved edits apply to future requests, but Stremio caches
images, so changes are **not instant**. After saving, reopen or refresh the
view in Stremio and give it time rather than saving repeatedly; both devices
converge once each re-requests the image. Rankings and upstream data refresh
on their own server schedules, so a new rank appears once the next refresh
runs and the client asks again.

Quick fixes: poster not showing → check you edited in your bookmarked space,
pressed **Save Poster**, and installed the manifest from that same space. Key
error → re-do Section 3 inside the correct space. Only want rows or search →
reopen **Install Hub** and reinstall with that mode. Slow/upstream hiccup →
back off and retry instead of hammering refresh.
