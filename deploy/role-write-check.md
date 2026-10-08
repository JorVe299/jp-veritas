# Checking that role saving works on the server

Run this on the Debian host after a deploy. It verifies the fix from commit
`8f4cef1` and settles the two symptoms recorded in BACKEND.md §9: roles failing
to save with "The permissions could not be saved", and "move up / move down
does not refresh".

Expected cause: `/opt/veritas/backend/data/` is not writable by the user the
service runs as. The store is written as a temp file that is then renamed into
place, so the **folder** must be writable — write permission on an existing
`permissions.json` alone is not enough.

## 1. Deploy the current main

```bash
sudo /opt/veritas/deploy/update.sh
```

Needs root for `systemctl restart veritas`. `backend/data/*.json` is gitignored,
so the hard reset does not touch the stored roles.

## 2. Note who the service runs as, and who owns the folder

```bash
systemctl show -p User veritas
ls -ld /opt/veritas/backend/data
ls -l  /opt/veritas/backend/data/
```

If the `User=` is empty the service runs as root and permissions are not the
cause — skip to step 6. Otherwise compare that user against the folder owner.

## 3. Reproduce in the panel

Sign in and create a role. One of two things happens:

- **It saves.** The fix is confirmed; go to step 5.
- **A red box appears.** It must now be headed by a failure, not "Role
  created" (that mislabelling was the second half of `8f4cef1`). Below the
  title, `hint` names the actual cause. Write the sentence down.

## 4. Read the errno and apply the matching fix

The backend logs the raw code next to the path:

```bash
journalctl -u veritas -n 50 --no-pager | grep '\[Perms\]'
```

The line reads `[Perms] could not write <path>: <CODE> <message>`. Map it:

| Code | What `hint` says | Fix |
| --- | --- | --- |
| `EACCES`, `EPERM` | not allowed to write the file, names the folder to chown | `sudo chown -R <service user> /opt/veritas/backend/data` |
| `EROFS` | the folder is mounted read-only | remount read-write, or move the data folder off that mount |
| `ENOSPC` | the disk is full | free space |
| `EISDIR` | `permissions.json` is a folder, not a file | `sudo rmdir`/`rm -r` it and let the panel recreate it |

After a `chown`, confirm the folder is also traversable and writable for that
user (`rename` needs write **and** execute on the folder):

```bash
sudo -u <service user> test -w /opt/veritas/backend/data && echo writable
sudo systemctl restart veritas
```

Then redo step 3.

## 5. Re-test the ordering symptom separately

Still in the panel, with saving now working:

1. Create a second role.
2. Use move up / move down.
3. Reload the page (F5) and check the order survived.

Ordering is persisted by the same refused-write path, so this very likely fixed
itself. If the order still does not stick **while saving works**, it is a real
and separate bug — report it as such rather than reopening the permissions
trail.

## 6. Clean up and report back

```bash
ls -l /opt/veritas/backend/data/*.tmp 2>/dev/null
```

A refused write unlinks its temp file, but a crash between write and rename can
leave one behind; it is safe to delete. Finally, report:

- the exact `hint` sentence, if one appeared
- the errno from the `[Perms]` log line
- what you changed to fix it
- whether move up / move down now survives a reload

That closes the role-saving entry in BACKEND.md §9.
