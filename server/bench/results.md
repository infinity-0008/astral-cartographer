# Astral Cartographer benchmark results

No performance numbers are pre-filled because they must be measured on the machine used for the final demo. Run `npm run bench -w server -- <repo-path-or-public-github-url> [another-target ...]` to generate this report. The script records the OS, CPU/RAM, clone and scan time (where applicable), serial versus worker-pool parse time, peak observed RSS, node/edge/cycle counts, and notes the browser FPS measurement separately.

For the contest report, use three public repositories with approximately 50, 500 and 3,000 supported JS/TS files, and record browser FPS with the graph visible in file and folder views.
