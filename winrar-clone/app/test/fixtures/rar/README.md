# RAR test fixtures

We cannot create RAR archives ourselves (see ADR-0006), so these samples come from the **libarchive** test
suite, version 3.8.9 (source: the Ubuntu archive `libarchive_3.8.9.orig.tar.xz`, `libarchive/test/*.rar.uu`,
uudecoded). libarchive is distributed under the BSD 2-Clause license (see its `COPYING`). The test files are
tiny synthetic archives with no third-party content.

| File | Original name | What it covers |
| --- | --- | --- |
| `rar4-basic.rar` | `test_read_format_rar.rar` | RAR 2.9/4 format, files, dirs, empty dir, symlink |
| `rar5-stored.rar` | `test_read_format_rar5_stored.rar` | Minimal RAR5, stored method |
| `rar5-multi-solid.part01..04.rar` | `test_read_format_rar5_multiarchive_solid.part0N.rar` | Solid multi-volume RAR5 |
| `rar5-encrypted.rar` | `test_read_format_rar5_encrypted.rar` | Encrypted file data (password unknown, use it for the "wrong password" path) |
| `rar5-encrypted-headers.rar` | `test_read_format_rar5_encrypted_filenames.rar` | Encrypted headers (listing needs a password) |
| `rar5-symlink.rar` | `test_read_format_rar5_symlink.rar` | Unix symlinks to a file and to a directory |

`SHA256SUMS` pins the exact bytes.
