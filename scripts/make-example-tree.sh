#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-./example}"

# Wipe and recreate root on each run (idempotent)
rm -rf "$ROOT"
mkdir -p "$ROOT"

mkf() { truncate -s "$1" "$2"; }  # sparse file — realistic size, no real disk use

# ── 1 & 7 & 8 & 9. Recurrent NS500598 – Run 1 (2015-01-06) ──────────────────
# Covers: L001 per-lane + merged (both for same sample), paired R1/R2,
#         files in fastq/ subdir, all noise-file types
D="$ROOT/150106_NS500598_0004_AH2NH3BGXX"
mkdir -p "$D/fastq" "$D/Config" "$D/InterOp" "$D/Logs"
mkf 850M "$D/fastq/GV1_S1_L001_R1_001.fastq.gz"
mkf 850M "$D/fastq/GV1_S1_L001_R2_001.fastq.gz"
mkf 1300M "$D/fastq/GV1_S1_R1_001.fastq.gz"     # merged – no lane token
touch "$D/RunInfo.xml" "$D/RunParameters.xml" "$D/SampleSheet.csv"
touch "$D/Config/Effective.cfg"
touch "$D/InterOp/QMetricsOut.bin"
touch "$D/Logs/Logs.zip"
touch "$D/fastq/sample.fastq"                     # uncompressed – must NOT match
touch "$D/fastq/report.txt.gz"                    # non-FASTQ .gz – must NOT match

# ── 1 & 7. Recurrent NS500598 – Run 2 (2018-12-05) ──────────────────────────
# Covers: L003, L004, Undetermined R1/R2
D="$ROOT/181205_NS500598_0099_AHLMYVBGX7"
mkdir -p "$D/fastq"
mkf 850M "$D/fastq/SampleA_S1_L003_R1_001.fastq.gz"
mkf 850M "$D/fastq/SampleA_S1_L003_R2_001.fastq.gz"
mkf 850M "$D/fastq/SampleA_S1_L004_R1_001.fastq.gz"
mkf 850M "$D/fastq/SampleA_S1_L004_R2_001.fastq.gz"
mkf 2M   "$D/fastq/Undetermined_S0_R1_001.fastq.gz"
mkf 2M   "$D/fastq/Undetermined_S0_R2_001.fastq.gz"

# ── 1 & 3 & 8. Recurrent NS500598 / shared flowcell – Run 3 (2017-11-30) ────
# Covers: L001 & L002, deep nesting (Data/Intensities/BaseCalls/)
D="$ROOT/171130_NS500598_0079_AH33CGBGX5"
mkdir -p "$D/Data/Intensities/BaseCalls"
mkf 4G "$D/Data/Intensities/BaseCalls/Sample_S1_L001_R1_001.fastq.gz"
mkf 4G "$D/Data/Intensities/BaseCalls/Sample_S1_L001_R2_001.fastq.gz"
mkf 4G "$D/Data/Intensities/BaseCalls/Sample_S1_L002_R1_001.fastq.gz"
mkf 4G "$D/Data/Intensities/BaseCalls/Sample_S1_L002_R2_001.fastq.gz"

# ── 1 & 3. Recurrent NS500598 / shared flowcell – Run 4 (2022-08-24) ────────
D="$ROOT/220824_NS500598_0173_AH33CGBGX5"
mkdir -p "$D/fastq"
mkf 1300M "$D/fastq/SmplB_S2_L001_R1_001.fastq.gz"
mkf 1300M "$D/fastq/SmplB_S2_L001_R2_001.fastq.gz"

# ── 1. Recurrent NS500598 – Run 5 (2022-01-10) ───────────────────────────────
# Covers: lane-less merged reads
D="$ROOT/220110_NS500598_0160_AHWVH5BGXK"
mkdir -p "$D/fastq"
mkf 2M "$D/fastq/Lib1_S1_R1_001.fastq.gz"
mkf 2M "$D/fastq/Lib1_S1_R2_001.fastq.gz"

# ── 1. Recurrent NS500598 – Run 6 (2024-01-10) ───────────────────────────────
# Covers: 0-byte (B) and 1500-byte (~1.5 KB) size rendering
D="$ROOT/240110_NS500598_0206_AHWGMGBGXT"
mkdir -p "$D/fastq"
mkf 1500 "$D/fastq/tiny_S1_L001_R1_001.fastq.gz"
touch    "$D/fastq/zero_S1_L001_R2_001.fastq.gz"  # literal 0 bytes

# ── 2 & 8. NovaSeq A00123 ────────────────────────────────────────────────────
# Covers: .fq.gz extension, L002
D="$ROOT/230615_A00123_0456_BHGV7DSX3"
mkdir -p "$D/fastq"
mkf 850M "$D/fastq/NovaA_S1_L002_R1_001.fq.gz"
mkf 850M "$D/fastq/NovaA_S1_L002_R2_001.fq.gz"

# ── 2 & 8. MiSeq M01234 ──────────────────────────────────────────────────────
# Covers: files at run-folder root (no subdir), 000000000-ABCDE-style flowcell
D="$ROOT/190301_M01234_0012_000000000-ABCDE"
mkdir -p "$D"
mkf 2M "$D/MiSeq_S1_L001_R1_001.fastq.gz"
mkf 2M "$D/MiSeq_S1_L001_R2_001.fastq.gz"

# ── 2. NextSeq 2000 VH00123 ──────────────────────────────────────────────────
D="$ROOT/211015_VH00123_0007_AABCDEFGH"
mkdir -p "$D/fastq"
mkf 850M "$D/fastq/NS2k_S1_L001_R1_001.fastq.gz"
mkf 850M "$D/fastq/NS2k_S1_L001_R2_001.fastq.gz"

# ── 4. Date / century-pivot edges (all valid → indexed) ──────────────────────
# 991231 → 1999-12-31 (70-99 → 19xx)
mkdir -p "$ROOT/991231"
mkf 1500 "$ROOT/991231/edge_S1_L001_R1_001.fastq.gz"
# 700101 → 1970-01-01 (boundary: yy=70 → 1970)
mkdir -p "$ROOT/700101"
mkf 1500 "$ROOT/700101/edge_S1_L001_R1_001.fastq.gz"
# 691231 → 2069-12-31 (boundary: yy=69 → 2069)
mkdir -p "$ROOT/691231"
mkf 1500 "$ROOT/691231/edge_S1_L001_R1_001.fastq.gz"
# 000101 → 2000-01-01
mkdir -p "$ROOT/000101"
mkf 1500 "$ROOT/000101/edge_S1_L001_R1_001.fastq.gz"

# ── 5. Date-only folders → null instrument/run/flowcell ──────────────────────
D="$ROOT/230616"
mkdir -p "$D"
mkf 2M "$D/y_S2_L002_R1_001.fastq.gz"
mkf 2M "$D/y_S2_L002_R2_001.fastq.gz"

D="$ROOT/180102"
mkdir -p "$D"
mkf 2M "$D/z_S3_R1_001.fastq.gz"   # no lane token

# ── 6. Extra trailing fields — flowcell absorbs the rest ─────────────────────
# flowcell = "AHGV7DSX3_rerun" (joined on _)
D="$ROOT/230701_A00123_0099_AHGV7DSX3_rerun"
mkdir -p "$D/fastq"
mkf 850M "$D/fastq/Rerun_S1_L001_R1_001.fastq.gz"
mkf 850M "$D/fastq/Rerun_S1_L001_R2_001.fastq.gz"

# ── 10. Skipped top-level dirs — wrong format ────────────────────────────────
for d in Config unsorted "2023-06-15" notarun; do
  mkdir -p "$ROOT/$d"
  touch "$ROOT/$d/should_be_ignored.fastq.gz"
done

# ── 10. Skipped top-level dirs — invalid calendar date ───────────────────────
mkdir -p "$ROOT/131340" && touch "$ROOT/131340/should_be_ignored.fastq.gz"  # month 13
mkdir -p "$ROOT/230600" && touch "$ROOT/230600/should_be_ignored.fastq.gz"  # day 00
mkdir -p "$ROOT/230632" && touch "$ROOT/230632/should_be_ignored.fastq.gz"  # day 32

# ── 11. Loose files directly under ROOT (skipped — no parent run folder) ─────
touch "$ROOT/orphan.fastq.gz"
touch "$ROOT/README.txt"

# ── 12. Adversarial: Feb 30 — passes coarse day 01-31 check, not a real date ─
# adversarial: parser yields 2023-02-30 and indexes this folder
D="$ROOT/230230"
mkdir -p "$D"
mkf 1500 "$D/adversarial_S1_L001_R1_001.fastq.gz"

# ── Summary ───────────────────────────────────────────────────────────────────
top_dirs=$(find "$ROOT" -mindepth 1 -maxdepth 1 -type d | wc -l)
fastq_files=$(find "$ROOT" -mindepth 2 \( -name '*.fastq.gz' -o -name '*.fq.gz' \) | wc -l)
printf 'Created %d top-level folders, %d .fastq.gz/.fq.gz files under %s\n' \
  "$top_dirs" "$fastq_files" "$ROOT"
