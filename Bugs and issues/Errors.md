### Tests and results.

# TEST 001

-Test 1.A The "Adversarial" Security Tests

-Test 1.B The "Inspect & Delete" Test

-Test 1.C The "Refresh Spam" Race Condition

-Test 1.D The "Stop Load" Bypass

-Test 2.A Subdomain Bypasses: Test old.reddit.com, new.reddit.com

-Test 2.B The "Embed" Loophole

-Test 2.C Search Engine "Sneak Peeks"

-Test 3.A Logic Accuracy:Examples: Ecchi (TRUE NEGATIVE)

-Test 3.B Art/Anatomy

-Test 3.C Text/Language


### TEST RESULTS.

1.A- SUCCESS

1.B- SUCCESS

1.C- SUCCESS

1.D- SUCCESS

2.A- SUCCESS

2.B- NOT TESTED PROPERLY (POTENTIAL FAIL)

2.C- SUCCESS

3.A- FAIL, Ecchi is a TRUE NEGATIVE (SHOULD BE BLOCKED, ANIME NSFW CATEGORY)

3.B- WAIT FOR PHASE 3

3.C- SUCCESS (TESTED WITH LEETSPEAK AND ENGLISH)


### OVERALL.

Performance: 9/10

Logic: 8/10

Embeds: nan/10

TOTAL: 8.5/10


### COMMENTS.

-Honestly its been great at blocking, However we missed one crucial true negative, Ecchi (the anime category)

-We should improve on the smart blocking, IF there is a suggestion to make the blocking more smart than list based it should be recommended.

-After improving on these, we will move to Phase 2. (The App)