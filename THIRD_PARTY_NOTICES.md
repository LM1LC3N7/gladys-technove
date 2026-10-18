# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## python-technove

<https://github.com/Moustachauve/pytechnove> (package `python-technove`), by
Christophe Gagnier. MIT License (`LICENSE` of the repository, version 2.1.3).
Its notice:

```
MIT License

Copyright (c) 2023 Christophe Gagnier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Ported in `src/constants.js`, `src/technove/client.js` and `src/devices.js`:
the local API on port 80 without authentication, the read of
`/station/get/info` and its fields (`id`, `name`, `version`, `status`,
`current`, `voltageIn`, `voltageOut`, `energySession`, `maxCurrent`,
`maxStationCurrent`, `auto_charge`, `isSessionActive`, `inSharingMode`,
`conflictInSharingConfig`), the status codes (ASCII codes of the SAE J1772
letters A to F and TechnoVE's H, S and T), the commands
`/station/control/start`, `/station/control/stop` and
`/station/control/partage` with its body `{" stationNumber": 1, "current": n}`
(leading space included), and the rules "no start or stop while automatic
charging is on", "no maximum current in load sharing mode", "maximum current
from 8 A to the rating of the station".

Changed: a missing or mistyped field is unknown (never python-technove's
default value), and a command that needs it is refused; the station is read
again right before each command, and the command decided on that read only;
the rating is trusted from 8 to 80 A only; a start is refused on a fault or
an unknown state; reads are not retried at once (spaced new tries) and
commands never; the power is computed (current × voltage), the API gives
none; the high-tariff schedule and the automatic charge are read only or not
used.

### python-wled

python-technove states that its request handling is based on
[python-wled](https://github.com/frenck/python-wled), by Franck Nijhof, and
ships its license in `third_party/python-wled/LICENSE`. That notice, kept
here for the same parts:

```
MIT License

Copyright (c) 2019-2023 Franck Nijhof

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
