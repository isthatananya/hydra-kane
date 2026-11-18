# Hydra heal request — round 1

A real-browser verification of this web app (a Next.js checkout) failed. The verifier is Kane CLI. The evidence below is the only information available about the failure.

## Kane verdict
- Status: failed (Kane exit code 1)
- Summary: The checkout calculated the shipping charge incorrectly after applying the coupon. There is no shipping option on the page that could produce the required amount.
Fix the coupon/checkout pricing rules so this cart applies the $6.00 discount, charges $4.00 shipping, and displays a $58.00 total.
evidence: objective_contradiction: SAVE10 applied, but shipping is $8.00 and total $62.00; no shipping control exists to reach the required $58.00.
- Kane run (ShareLink): https://test-manager.lambdatest.com/projects/01M7QMJZXZHZEHKD5P7YP1D077/test-cases/01M7R1CXHMSQC0EGF6FNGWK9R9/dashboard/share/US_D9K8RMOCQXLL9XL3LC0ZT9EXVX7GY8DQEL6Z5ZZACB574ANCM82UT2KBJIRII57M?type=summary&agentView=true&fqdn=summary-page

## Evidence files (paths relative to the current directory)
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_steps_12-0-12_screenshot.jpg
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_steps_13-0-13_annotated.png
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_steps_14-0-14_annotated.png
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_steps_15-0-15_screenshot.jpg
- console log: .hydra-evidence/round-1/pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_logs_0-console.ndjson
- network log: .hydra-evidence/round-1/pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_logs_0-network.har
- commands log: .hydra-evidence/round-1/pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_logs_0-actions.ndjson
- other log: .hydra-evidence/round-1/pack_run-0_code-export_requirements.txt
- other log: .hydra-evidence/round-1/pack_run-0_events.ndjson
- other log: .hydra-evidence/round-1/pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_auteur_execution.json

### network log excerpt (pack_run-0_evidence_be05d36c-2f6e-447a-9f83-54b38835b358_tests_you-are-testing-the-hydra-supply-co-chec-9a4db17a_logs_0-network.har)
```
…ers": [{"name": "referer", "value": "http://localhost:3100/"}], "queryString": [], "cookies": [], "headersSize": -1, "bodySize": -1}, "response": {"status": 200, "statusText": "", "httpVersion": "", "headers": [{"name": "transfer-encoding", "value": "chunked"}, {"name": "cache-control", "value": "public, max-age=31536000, immutable"}, {"name": "content-encoding", "value": "gzip"}, {"name": "etag", "value": "W/\"1eb6-1a1f016314a\""}, {"name": "connection", "value": "keep-alive"}, {"name": "accept-ranges", "value": "bytes"}, {"name": "keep-alive", "value": "timeout=5"}, {"name": "date", "value": "Wed, 18 Nov 2026 19:16:05 GMT"}, {"name": "last-modified", "value": "Wed, 18 Nov 2026 19:15:48 GMT"}, {"name": "content-type", "value": "application/javascript; charset=UTF-8"}, {"name": "vary", "value": "Accept-Encoding"}], "cookies": [], "content": {"size": -1, "mimeType": "application/javascript; charset=UTF-8"}, "redirectURL": "", "headersSize": -1, "bodySize": -1}, "cache": {}, "timings": {"send": 0, "wait": 15.309814453125, "receive": -14.30859375}, "_sequence": 8, "_step": "0-1", "_ordinal": 1, "_resource_type": "script", "_failed": false}, {"startedDateTime": "2026-11-18T19:16:16.471670+00:00", "time": 1.0, "request": {"method": "GET", "url": "http://localhost:3100/_next/static/chunks/2l_6as95_f5l5.js", "httpVersion": "", "headers": [{"name": "referer", "value": "http://localhost:3100/"}], "queryString": [], "cookies": [], "headersSize": -1, "bodySize": -1}, "response": {"status": 200, "statusText": "", "httpVersion": "", "headers": [{"name": "transfer-encoding", "value": "chunked"}, {"name": "cache-control", "value": "public, max-age=31536000, immutable"}, {"name": "content-encoding", "value": "gzip"}, {"name": "etag", "value": "W/\"22b7-1a1f0163194\""}, {"name": "connection", "value": "keep-alive"}, {"name": "accept-ranges", "value": "bytes"}, {"name": "keep-alive", "value": "timeout=5"}, {"name": "date", "value": "Wed, 18 Nov 2026 19:16:05 GMT"}, {"name": "last-modified", "value": "Wed, 18 Nov 2026 19:15:48 GMT"}, {"name": "content-type", "value": "application/javascript; charset=UTF-8"}, {"name": "vary", "value": "Accept-Encoding"}], "cookies": [], "content": {"size": -1, "mimeType": "application/javascript; charset=UTF-8"}, "redirectURL": "", "headersSize": -1, "bodySize": -1}, "cache": {}, "timings": {"send": 0, "wait": 14.30859375, "receive": -13.30859375}, "_sequence": 9, "_step": "0-1", "_ordinal": 1, "_resource_type": "script", "_failed": false}]}}
```

## Rules
- Find and fix the root cause in the application source code.
- Do not special-case, hardcode or detect the specific values, names or codes mentioned above.
- Only edit files matching: app/**, components/**, lib/**. Changes anywhere else are reverted.
- The verification flows are not part of this workspace. Do not create or modify tests to make the check pass.
- Do not install packages, start servers or run the app. Hydra rebuilds the app and re-runs Kane after you finish.
- Keep the change minimal. When you are done, stop.
