# TOKVERSE

the trenches went vertical. A pixel tower where every floor holds live pump.fun coins by market cap.
Green candles take the elevator, red candles take the stairs.

- `index.html`, `css/`, `js/`: the game (no build step, plain ES modules)
- `api/tower.js`: live coins from pump.fun's public lists, checked against Dexscreener (cached 30 s at the edge)
- `api/img.js`: same-origin proxy for coin logos (allowlisted hosts only)
- `api/launch.js`: Launch Lab proxy for pump.fun IPFS + PumpPortal (the user's wallet signs; no keys on the server)
- `assets/`: pixel art, `fonts/`: Press Start 2P, Jersey 10, Silkscreen (SIL OFL, licences included), `vendor/`: @solana/web3.js 1.95.3

Set the coin's CA and X link in `js/app.js` (`CFG`) after launch.
Not affiliated with pump.fun. Not financial advice.
