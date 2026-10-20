'use strict';

// Captured from real runs of .github/workflows/actions-playground.yml (docs/plans/github-actions-logs.md, Task 1).
// REAL_*: the run dispatched with fail=true. SKIPPED_*: fail=false, so the "Maybe fail" step was skipped.
// NOTE: `run:` echo lines carry ANSI colour escapes (ESC[36;1m ... ESC[0m); cleanLog strips them.
export interface FixtureStep { number: number; name: string; status: string; conclusion: string | null }

export const REAL_LOG = "﻿2026-10-20T16:00:40.0100388Z Current runner version: '2.337.0'\n2026-10-20T16:00:40.0136720Z ##[group]Runner Image Provisioner\n2026-10-20T16:00:40.0138473Z Hosted Compute Agent\n2026-10-20T16:00:40.0139495Z Version: 20261012.601\n2026-10-20T16:00:40.0140505Z Commit: f3dc54e1fb89da6852db922499a0233137369e1d\n2026-10-20T16:00:40.0141878Z Build Date: 2026-10-12T17:48:21Z\n2026-10-20T16:00:40.0143077Z Worker ID: {d988bfb2-a38d-4b27-9c61-54563d324868}\n2026-10-20T16:00:40.0144293Z Region: eastus\n2026-10-20T16:00:40.0145251Z Cloud: Azure\n2026-10-20T16:00:40.0146115Z ##[endgroup]\n2026-10-20T16:00:40.0149303Z ##[group]Operating System\n2026-10-20T16:00:40.0150461Z Ubuntu\n2026-10-20T16:00:40.0151342Z 24.04.5\n2026-10-20T16:00:40.0152223Z LTS\n2026-10-20T16:00:40.0153067Z ##[endgroup]\n2026-10-20T16:00:40.0154072Z ##[group]Runner Image\n2026-10-20T16:00:40.0155096Z Image: ubuntu-24.04\n2026-10-20T16:00:40.0156121Z Version: 20261012.334.1\n2026-10-20T16:00:40.0158519Z Included Software: https://github.com/actions/runner-images/blob/ubuntu24/20261012.334/images/ubuntu/Ubuntu2404-Readme.md\n2026-10-20T16:00:40.0161293Z Image Release: https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20261012.334\n2026-10-20T16:00:40.0163028Z ##[endgroup]\n2026-10-20T16:00:40.0165162Z ##[group]GITHUB_TOKEN Permissions\n2026-10-20T16:00:40.0168450Z Contents: read\n2026-10-20T16:00:40.0169550Z Metadata: read\n2026-10-20T16:00:40.0170546Z Packages: read\n2026-10-20T16:00:40.0171514Z ##[endgroup]\n2026-10-20T16:00:40.0174525Z Secret source: Actions\n2026-10-20T16:00:40.0176699Z Cache mode: write\n2026-10-20T16:00:40.0178561Z Prepare workflow directory\n2026-10-20T16:00:40.0654239Z Prepare all required actions\n2026-10-20T16:00:40.0819673Z Complete job name: build\n2026-10-20T16:00:40.2100852Z ##[group]Run echo \"hello probe (vanilla)\"\n2026-10-20T16:00:40.2102425Z \u001b[36;1mecho \"hello probe (vanilla)\"\u001b[0m\n2026-10-20T16:00:40.2982014Z shell: /usr/bin/bash -e {0}\n2026-10-20T16:00:40.2983231Z ##[endgroup]\n2026-10-20T16:00:40.3212065Z hello probe (vanilla)\n2026-10-20T16:00:40.3399400Z ##[group]Run echo \"::group::Counting\"\n2026-10-20T16:00:40.3400064Z \u001b[36;1mecho \"::group::Counting\"\u001b[0m\n2026-10-20T16:00:40.3400743Z \u001b[36;1mfor i in 1 2 3 4 5 6; do echo \"tick $i\"; sleep 5; done\u001b[0m\n2026-10-20T16:00:40.3401421Z \u001b[36;1mecho \"::endgroup::\"\u001b[0m\n2026-10-20T16:00:40.3465683Z shell: /usr/bin/bash -e {0}\n2026-10-20T16:00:40.3466208Z ##[endgroup]\n2026-10-20T16:00:40.3566736Z ##[group]Counting\n2026-10-20T16:00:40.3567502Z tick 1\n2026-10-20T16:00:45.3574442Z tick 2\n2026-10-20T16:00:50.3589099Z tick 3\n2026-10-20T16:00:55.3608540Z tick 4\n2026-10-20T16:01:00.3626615Z tick 5\n2026-10-20T16:01:05.3645121Z tick 6\n2026-10-20T16:01:10.3669247Z ##[endgroup]\n2026-10-20T16:01:10.3715072Z ##[group]Run echo \"::warning file=src/a.ts,line=3,col=4::Something odd\"\n2026-10-20T16:01:10.3715669Z \u001b[36;1mecho \"::warning file=src/a.ts,line=3,col=4::Something odd\"\u001b[0m\n2026-10-20T16:01:10.3716154Z \u001b[36;1mecho \"src/a.ts(3,4): error TS2304: Cannot find name 'x'.\"\u001b[0m\n2026-10-20T16:01:10.3782065Z shell: /usr/bin/bash -e {0}\n2026-10-20T16:01:10.3782430Z ##[endgroup]\n2026-10-20T16:01:10.3886705Z ##[warning]Something odd\n2026-10-20T16:01:10.3894036Z src/a.ts(3,4): error TS2304: Cannot find name 'x'.\n2026-10-20T16:01:10.3950408Z ##[group]Run echo \"::error::Told to fail\"\n2026-10-20T16:01:10.3950834Z \u001b[36;1mecho \"::error::Told to fail\"\u001b[0m\n2026-10-20T16:01:10.3951163Z \u001b[36;1mexit 1\u001b[0m\n2026-10-20T16:01:10.4010281Z shell: /usr/bin/bash -e {0}\n2026-10-20T16:01:10.4010598Z ##[endgroup]\n2026-10-20T16:01:10.4095417Z ##[error]Told to fail\n2026-10-20T16:01:10.4098259Z ##[error]Process completed with exit code 1.\n2026-10-20T16:01:10.4182982Z Cleaning up orphan processes\n";
export const REAL_STEPS: FixtureStep[] = [
  {
    "conclusion": "success",
    "name": "Set up job",
    "number": 1,
    "status": "completed"
  },
  {
    "conclusion": "success",
    "name": "Greet",
    "number": 2,
    "status": "completed"
  },
  {
    "conclusion": "success",
    "name": "Slow output",
    "number": 3,
    "status": "completed"
  },
  {
    "conclusion": "success",
    "name": "Warn and error",
    "number": 4,
    "status": "completed"
  },
  {
    "conclusion": "failure",
    "name": "Maybe fail",
    "number": 5,
    "status": "completed"
  },
  {
    "conclusion": "success",
    "name": "Complete job",
    "number": 6,
    "status": "completed"
  }
];

export const SKIPPED_LOG = "﻿2026-10-20T16:01:27.5114397Z Current runner version: '2.337.0'\n2026-10-20T16:01:27.5135910Z ##[group]Runner Image Provisioner\n2026-10-20T16:01:27.5136791Z Hosted Compute Agent\n2026-10-20T16:01:27.5137342Z Version: 20261015.610\n2026-10-20T16:01:27.5137893Z Commit: 267fdb4e8bbec4ab5ea31367f3a00d5c480c7656\n2026-10-20T16:01:27.5138538Z Build Date: 2026-10-14T17:06:54Z\n2026-10-20T16:01:27.5139151Z Worker ID: {40f2078e-f030-42c1-8a16-b411a215f3d4}\n2026-10-20T16:01:27.5139734Z Region: westus3\n2026-10-20T16:01:27.5140187Z Cloud: Azure\n2026-10-20T16:01:27.5140712Z ##[endgroup]\n2026-10-20T16:01:27.5142205Z ##[group]Operating System\n2026-10-20T16:01:27.5142835Z Ubuntu\n2026-10-20T16:01:27.5143288Z 24.04.5\n2026-10-20T16:01:27.5143716Z LTS\n2026-10-20T16:01:27.5144236Z ##[endgroup]\n2026-10-20T16:01:27.5144717Z ##[group]Runner Image\n2026-10-20T16:01:27.5145239Z Image: ubuntu-24.04\n2026-10-20T16:01:27.5145743Z Version: 20261018.339.1\n2026-10-20T16:01:27.5147064Z Included Software: https://github.com/actions/runner-images/blob/ubuntu24/20261018.339/images/ubuntu/Ubuntu2404-Readme.md\n2026-10-20T16:01:27.5148460Z Image Release: https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20261018.339\n2026-10-20T16:01:27.5149310Z ##[endgroup]\n2026-10-20T16:01:27.5150367Z ##[group]GITHUB_TOKEN Permissions\n2026-10-20T16:01:27.5152193Z Contents: read\n2026-10-20T16:01:27.5152758Z Metadata: read\n2026-10-20T16:01:27.5153264Z Packages: read\n2026-10-20T16:01:27.5153799Z ##[endgroup]\n2026-10-20T16:01:27.5155525Z Secret source: Actions\n2026-10-20T16:01:27.5156383Z Cache mode: write\n2026-10-20T16:01:27.5157400Z Prepare workflow directory\n2026-10-20T16:01:27.5818294Z Prepare all required actions\n2026-10-20T16:01:27.5902983Z Complete job name: build\n2026-10-20T16:01:27.8213083Z ##[group]Run echo \"hello skip (vanilla)\"\n2026-10-20T16:01:27.8213796Z \u001b[36;1mecho \"hello skip (vanilla)\"\u001b[0m\n2026-10-20T16:01:27.9775203Z shell: /usr/bin/bash -e {0}\n2026-10-20T16:01:27.9776075Z ##[endgroup]\n2026-10-20T16:01:28.0025875Z hello skip (vanilla)\n2026-10-20T16:01:28.0395786Z ##[group]Run echo \"::group::Counting\"\n2026-10-20T16:01:28.0396321Z \u001b[36;1mecho \"::group::Counting\"\u001b[0m\n2026-10-20T16:01:28.0397080Z \u001b[36;1mfor i in 1 2 3 4 5 6; do echo \"tick $i\"; sleep 5; done\u001b[0m\n2026-10-20T16:01:28.0397618Z \u001b[36;1mecho \"::endgroup::\"\u001b[0m\n2026-10-20T16:01:28.0445292Z shell: /usr/bin/bash -e {0}\n2026-10-20T16:01:28.0445751Z ##[endgroup]\n2026-10-20T16:01:28.0622114Z ##[group]Counting\n2026-10-20T16:01:28.0622563Z tick 1\n2026-10-20T16:01:33.0630250Z tick 2\n2026-10-20T16:01:38.0645033Z tick 3\n2026-10-20T16:01:43.0659940Z tick 4\n2026-10-20T16:01:48.0674596Z tick 5\n2026-10-20T16:01:53.0689499Z tick 6\n2026-10-20T16:01:58.0707410Z ##[endgroup]\n2026-10-20T16:01:58.1741896Z ##[group]Run echo \"::warning file=src/a.ts,line=3,col=4::Something odd\"\n2026-10-20T16:01:58.1742411Z \u001b[36;1mecho \"::warning file=src/a.ts,line=3,col=4::Something odd\"\u001b[0m\n2026-10-20T16:01:58.1742807Z \u001b[36;1mecho \"src/a.ts(3,4): error TS2304: Cannot find name 'x'.\"\u001b[0m\n2026-10-20T16:01:58.1790884Z shell: /usr/bin/bash -e {0}\n2026-10-20T16:01:58.1791170Z ##[endgroup]\n2026-10-20T16:01:58.2969356Z ##[warning]Something odd\n2026-10-20T16:01:58.2975121Z src/a.ts(3,4): error TS2304: Cannot find name 'x'.\n2026-10-20T16:01:58.3070626Z Cleaning up orphan processes\n";
export const SKIPPED_STEPS: FixtureStep[] = [
  {
    "conclusion": "success",
    "name": "Set up job",
    "number": 1,
    "status": "completed"
  },
  {
    "conclusion": "success",
    "name": "Greet",
    "number": 2,
    "status": "completed"
  },
  {
    "conclusion": "success",
    "name": "Slow output",
    "number": 3,
    "status": "completed"
  },
  {
    "conclusion": "success",
    "name": "Warn and error",
    "number": 4,
    "status": "completed"
  },
  {
    "conclusion": "skipped",
    "name": "Maybe fail",
    "number": 5,
    "status": "completed"
  },
  {
    "conclusion": "success",
    "name": "Complete job",
    "number": 6,
    "status": "completed"
  }
];
