# The Hall of Fame in a file of its own

From the release after 2.10.0, the Hall of Fame's list of past games is kept in a SQLite file of the mod's own instead
of the shared `modSettings` entry in the game's `localStorage`. The list itself (one JSON slice, as
`history-archive.js` builds it, with the same 512 KB budget and pruning) doesn't change; only where it's kept does.
Demographics' settings stay in `modSettings`. The engine behaviour this rests on was watched on 2026-10-26 and is in
the workspace's `engine-closed.md`, the `ATTACH DATABASE` entry.

## The file

- Name: `demographics-halloffame.sqlite`.
- Folder: the game's user folder, the one that holds `LocalStorage.sqlite` and `Saves/`
  (`~/Library/Application Support/Civilization VII/` on the Mac, `%LOCALAPPDATA%\Firaxis Games\Sid Meier's
  Civilization VII\` on Windows).
- How the script finds the folder: no engine call names it, but the save list does. At page load the store asks
  `GameStateStorage.querySaveGameList` for the most recent local save (`SaveLocations.LOCAL_STORAGE`,
  `SaveLocationOptions.MOST_RECENT_ONLY`), and the answer's `path` is absolute. Everything before its last `Saves`
  folder is the user folder, on either separator. The query answers in 20 to 36 ms through
  `engine.on("FileListQueryResults")`. A player with no local save gets no path, and the session uses `modSettings`
  as 2.10.0 does; the first autosave of their first game fixes that for the next page load.
- A relative file name would land in the process's working folder, which on the Mac is inside the app bundle, where
  a Steam verify or update can remove it. The store never uses one.

## The schema

```sql
CREATE TABLE IF NOT EXISTS demographics_hof.HallOfFame (
  Id INTEGER PRIMARY KEY CHECK (Id = 1),
  Schema INTEGER NOT NULL,
  Payload TEXT NOT NULL,
  Backup TEXT,
  Updated INTEGER NOT NULL
);
```

`Payload` is the JSON slice. `Schema` is `ARCHIVE_SCHEMA`. `Backup` holds the payload before the last write that
changed it.

## The attach

The file is attached to the `config` database under the alias `demographics_hof`, with the plain absolute path bound
as a parameter (a `file:` URI would trip over Windows backslashes). The store checks `PRAGMA database_list` before
attaching, because an attachment outlives a UI reload on the same connection and a second attach of the alias logs an
error. The main menu and a game each get their own `config` connection, so each page attaches for itself. The store
never detaches.

A failed `ATTACH` doesn't throw: it returns `[]` and logs `ERROR: unable to open database` to `Database.log`. So the
store reads `PRAGMA database_list` again afterwards and only trusts the attach when the alias is listed with the file
it asked for.

## The write

One statement:

```sql
INSERT INTO demographics_hof.HallOfFame (Id, Schema, Payload, Backup, Updated) VALUES (1, ?1, ?2, NULL, ?3)
ON CONFLICT(Id) DO UPDATE SET
  Backup = CASE WHEN HallOfFame.Payload = excluded.Payload THEN HallOfFame.Backup ELSE HallOfFame.Payload END,
  Payload = excluded.Payload, Schema = excluded.Schema, Updated = excluded.Updated
```

then a read-back of `Payload`, compared with the text written. The comparison is stricter than today's
`verifyWrite` (which checks that every game id is there): the text has to match. Before each write the store reads
the file and merges it in, as `persistArchive` merges the `modSettings` slice today. A write that doesn't read back
puts the session on `modSettings` (below) and writes there at once, so the game it was saving isn't lost.

## Reading

The store reads `Payload`. If it isn't a slice this version recognises (bad JSON, or a newer `Schema`), it reads
`Backup`. If neither is usable, the store leaves the file alone and uses `modSettings` for the session.

## Migration

It runs whenever the file is in use and `modSettings` still holds `demographics-halloffame`, which after the first
time only happens when an older copy of the mod wrote it again:

1. Read the `modSettings` slice with today's `readRoot`, with the same statuses.
2. `mergeSlices` it into the file's slice.
3. Write the file and read it back.
4. Only then write `modSettings` back without `demographics-halloffame`, under today's rules: write only a root that
   read `ok`, then read it back. Every other section, Tower Settings Keeper's `__ls` and `__settings-keeper`
   included, goes back as it was read.

If step 4 fails, the slice stays in `modSettings`. The file is the source from then on, and a later load removes the
slice. Because every load merges, a player who goes back to 2.10.0, plays, and returns gets both sets of games.

Migration is the one write at load time. It happens once per install, plus once each time an older copy wrote the
slice again.

## When the file can't be used

The session uses `modSettings` exactly as 2.10.0 does when any of these happens: the save list gives no path, or
doesn't answer in 5 seconds; the attach doesn't list the file; the file holds nothing this version can read; or a
file write doesn't read back. The next page load tries the file again.

If something calls the store before the save list has answered (the folder query is async; the store's interface is
not), the store starts on `modSettings`. When the answer comes, it reads the file, merges it into what it holds,
writes the file and moves the slice out of `modSettings` as above. The Hall of Fame is opened by a click, long after
the 36 ms the query takes. The game's own record is first saved when the game finishes loading, which may come before
the answer; that save goes to `modSettings` and moves to the file with the rest.

## Footer and Repair

`archiveStatus()` keeps its values. With the file in use it reports the file: `ok`, or `empty` while the file and
`modSettings` both hold no games. A broken shared store then no longer blocks the Hall of Fame, but it can still stop
Demographics' settings from saving, and the settings line under the list says "Repair storage on the Hall of Fame page
fixes this". So when that line shows, the existing repair button and sheet show with it, as they do today under the
"could not be read" note. No new text.

`repairStorage()`, with the file in use, empties the shared store and writes back only Demographics' settings slice;
the file isn't touched. With `modSettings` in use, it does what it does today.

## Going back to 2.10.0

2.10.0 reads only `modSettings`, so after the move it shows an empty Hall of Fame. The file is still there, and the
next upgrade merges both sets back together. The CHANGELOG says this in one line.
