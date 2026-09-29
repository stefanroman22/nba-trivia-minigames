Narrow round 1's two over-reaching rules (one hypothesis: the new risk and multi-area rules fire on work that only touches a surface indirectly).

- Risk: name the risk-high surfaces directly instead of citing "AUTH-11" by number (on older repo states AUTH-11 is a different rule - the number was fragile), and judge risk by the production code the change modifies, not the code its tests cover. v1: r13 (tests-only fix for FriendsPhotoTests) rated high 1/2 -> opus.
- Multi-area: `multiplayer` means the relay / protocol / sim scripts; a UI element on a multiplayer screen is frontend/ui only. v1: u12 (copy-link button next to the room code) tagged multiplayer -> design round 2/2.
Expected: r13 and u12 back to routing 1 without undoing v1's gains (r10 still involves the sim; r15 still modifies CACHES/settings; r11 still modifies photo production code).
