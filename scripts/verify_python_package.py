#!/usr/bin/env python3
"""Verify Pulseboard's built distributions preserve the PEP 639 licence contract."""

from __future__ import annotations

import argparse
import tarfile
import zipfile
from email.message import Message
from email.parser import BytesParser
from pathlib import Path

EXPECTED_LICENSE_EXPRESSION = "GPL-3.0-only"
EXPECTED_LICENSE_FILES = (
    "LICENSE",
    "LICENSES/MIT.txt",
    "LICENSES/Tailwind-MIT.txt",
    "RELICENSING.md",
    "THIRD_PARTY_NOTICES.md",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "dist_dir",
        nargs="?",
        type=Path,
        default=Path("dist"),
        help="directory containing exactly one wheel and one source distribution",
    )
    return parser.parse_args()


def single_match(dist_dir: Path, pattern: str, label: str) -> Path:
    matches = sorted(dist_dir.glob(pattern))
    if len(matches) != 1:
        raise AssertionError(
            f"expected exactly one {label} matching {pattern!r}, found {matches}"
        )
    return matches[0]


def parse_metadata(payload: bytes, source: str) -> Message:
    metadata = BytesParser().parsebytes(payload)
    if metadata.get("Metadata-Version") != "2.4":
        raise AssertionError(
            f"{source}: expected Metadata-Version 2.4, got "
            f"{metadata.get('Metadata-Version')!r}"
        )
    if metadata.get("License-Expression") != EXPECTED_LICENSE_EXPRESSION:
        raise AssertionError(
            f"{source}: expected License-Expression {EXPECTED_LICENSE_EXPRESSION!r}, got "
            f"{metadata.get('License-Expression')!r}"
        )

    declared = set(metadata.get_all("License-File", []))
    expected = set(EXPECTED_LICENSE_FILES)
    if declared != expected:
        raise AssertionError(
            f"{source}: License-File headers differ; expected {sorted(expected)}, "
            f"got {sorted(declared)}"
        )
    return metadata


def verify_wheel(wheel: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        metadata_names = sorted(name for name in names if name.endswith(".dist-info/METADATA"))
        if len(metadata_names) != 1:
            raise AssertionError(
                f"{wheel}: expected one .dist-info/METADATA entry, found {metadata_names}"
            )

        metadata_name = metadata_names[0]
        parse_metadata(archive.read(metadata_name), f"{wheel}:{metadata_name}")
        licence_root = metadata_name.removesuffix("METADATA") + "licenses/"

        for relative_path in EXPECTED_LICENSE_FILES:
            archive_path = licence_root + relative_path
            if archive_path not in names:
                raise AssertionError(f"{wheel}: missing {archive_path}")
            expected_bytes = Path(relative_path).read_bytes()
            actual_bytes = archive.read(archive_path)
            if actual_bytes != expected_bytes:
                raise AssertionError(f"{wheel}: {archive_path} differs from the source file")


def verify_sdist(sdist: Path) -> None:
    with tarfile.open(sdist, "r:gz") as archive:
        members = {member.name: member for member in archive.getmembers() if member.isfile()}
        metadata_names = sorted(name for name in members if name.endswith("/PKG-INFO"))
        if len(metadata_names) != 1:
            raise AssertionError(f"{sdist}: expected one PKG-INFO entry, found {metadata_names}")

        metadata_name = metadata_names[0]
        metadata_file = archive.extractfile(members[metadata_name])
        if metadata_file is None:
            raise AssertionError(f"{sdist}: could not read {metadata_name}")
        parse_metadata(metadata_file.read(), f"{sdist}:{metadata_name}")
        package_root = metadata_name.removesuffix("PKG-INFO")

        for relative_path in EXPECTED_LICENSE_FILES:
            archive_path = package_root + relative_path
            member = members.get(archive_path)
            if member is None:
                raise AssertionError(f"{sdist}: missing {archive_path}")
            archived_file = archive.extractfile(member)
            if archived_file is None:
                raise AssertionError(f"{sdist}: could not read {archive_path}")
            expected_bytes = Path(relative_path).read_bytes()
            actual_bytes = archived_file.read()
            if actual_bytes != expected_bytes:
                raise AssertionError(f"{sdist}: {archive_path} differs from the source file")


def main() -> None:
    args = parse_args()
    wheel = single_match(args.dist_dir, "*.whl", "wheel")
    sdist = single_match(args.dist_dir, "*.tar.gz", "source distribution")
    verify_wheel(wheel)
    verify_sdist(sdist)
    print(
        "Verified PEP 639 metadata and licence payloads in "
        f"{wheel.name} and {sdist.name}."
    )


if __name__ == "__main__":
    main()
