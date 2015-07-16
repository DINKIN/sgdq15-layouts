'use strict';

var app = require('express')();
var Rieussec = require('rieussec');
var NUM_STOPWATCHES = 4;

module.exports = function (nodecg) {
    var defaultStopwatch = {time: '00:00:00', state: 'stopped', milliseconds: 0};
    var defaultStopwatches = [defaultStopwatch, defaultStopwatch, defaultStopwatch, defaultStopwatch];
    var stopwatches = nodecg.Replicant('stopwatches', {defaultValue: defaultStopwatches});

    // Add the runner's name to the stopwatch, because testrunner needs that for his API stuff.
    // We cheat and don't define a default here, because extension/schedule.js should have already done it.
    nodecg.Replicant('currentRun')
        .on('change', function(oldVal, newVal) {
            newVal.runners.forEach(function(runner, index) {
                stopwatches.value[index].runner = runner;
            });
        });

    // Make sure all timers are set to "paused"
    stopwatches.value.forEach(function(stopwatch) {
        stopwatch.state = stopwatch.time === '00:00:00' ? 'stopped' : 'paused';
    });

    // Make an array of 4 Rieussec rieussecs
    var rieussecs = [null, null, null, null].map(function(val, index) {
        // Load the existing time and start the stopwatch at that.
        var startMs = 0;
        if (stopwatches.value[index].time) {
            var ts = stopwatches.value[index].time.split(':');
            startMs = Date.UTC(1970, 0, 1, ts[0], ts[1], ts[2]);
        }

        var rieussec = new Rieussec();
        rieussec.setMilliseconds(startMs);

        rieussec.on('tick', function(ms) {
            stopwatches.value[index].time = msToTime(ms);
            stopwatches.value[index].milliseconds = ms;
        });

        rieussec.on('state', function(state) {
            stopwatches.value[index].state = state;
        });

        return rieussec;
    });

    nodecg.listenFor('startTime', startStopwatch);
    nodecg.listenFor('pauseTime', pauseStopwatch);
    nodecg.listenFor('finishTime', finishStopwatch);
    nodecg.listenFor('resetTime', resetStopwatch);
    nodecg.listenFor('setTime', setStopwatch);

    app.get('/sgdq15-layouts/stopwatches', function (req, res) {
        res.json(stopwatches.value);
    });

    app.put('/sgdq15-layouts/stopwatch/:index/start', function (req, res) {
        var result = startStopwatch(req.params.index);
        if (result) {
            res.status(200).json(result);
        } else {
            res.status(422).send('Invalid stopwatch index "' + req.params.index + '"');
        }
    });

    app.put('/sgdq15-layouts/stopwatch/:index/pause', function (req, res) {
        var result = pauseStopwatch(req.params.index);
        if (result) {
            res.status(200).json(result);
        } else {
            res.status(422).send('Invalid stopwatch index "' + req.params.index + '"');
        }
    });

    app.put('/sgdq15-layouts/stopwatch/:index/finish', function (req, res) {
        var result = finishStopwatch(req.params.index);
        if (result) {
            res.status(200).json(result);
        } else {
            res.status(422).send('Invalid stopwatch index "' + req.params.index + '"');
        }
    });

    app.put('/sgdq15-layouts/stopwatch/:index/reset', function (req, res) {
        var result = resetStopwatch(req.params.index);
        if (result) {
            res.status(200).json(result);
        } else {
            res.status(422).send('Invalid stopwatch index "' + req.params.index + '"');
        }
    });

    nodecg.mount(app);

    function startStopwatch(index) {
        if (index === 'all') {
            rieussecs.forEach(function(sw) { sw.start(); });
            return stopwatches.value;
        } else if (index >= 0 && index < NUM_STOPWATCHES) {
            rieussecs[index].start();
            return stopwatches.value[index];
        } else {
            nodecg.log.error('index "%d" sent to "startTime" is out of bounds', index);
            return false;
        }
    }

    function pauseStopwatch (index) {
        if (index === 'all') {
            rieussecs.forEach(function(sw) { sw.pause(); });
            return stopwatches.value;
        } else if (index >= 0 && index < NUM_STOPWATCHES) {
            rieussecs[index].pause();
            return stopwatches.value[index];
        } else {
            nodecg.log.error('index "%d" sent to "pauseTime" is out of bounds', index);
            return false;
        }
    }

    function finishStopwatch (index) {
        if (index === 'all') {
            rieussecs.forEach(function(sw) { sw.pause(); });
            return stopwatches.value;
        } else if (index >= 0 && index < NUM_STOPWATCHES) {
            rieussecs[index].pause();
            stopwatches.value[index].state = 'finished';
            return stopwatches.value[index];
        } else {
            nodecg.log.error('index "%d" sent to "finishTime" is out of bounds', index);
            return false;
        }
    }

    function resetStopwatch (index) {
        if (index === 'all') {
            rieussecs.forEach(function(sw) { sw.reset(); });
            return stopwatches.value;
        } else if (index >= 0 && index < NUM_STOPWATCHES) {
            rieussecs[index].reset();
            return stopwatches.value[index];
        } else {
            nodecg.log.error('index "%d" sent to "resetTime" is out of bounds', index);
            return false;
        }
    }

    function setStopwatch (data) {
        var index = data.index;
        if (index >= 0 && index < NUM_STOPWATCHES) {
            // Pause all timers while we do our work.
            // Best way to ensure that all the tick cycles stay in sync.
            rieussecs.forEach(function(rieussec){
                rieussec._cachedState = rieussec._state;
                rieussec.pause();
            });

            rieussecs[index].setMilliseconds(data.ms, true);
            var decimal = rieussecs[index]._milliseconds % 1;

            // This is a silly hack, but set the decimal of all the Rieussec's millisecond counters to the same value.
            // This too helps ensure that the tick cycles remain in sync.
            rieussecs.forEach(function(rieussec){
                var ms = Math.floor(rieussec._milliseconds) + decimal;
                rieussec.setMilliseconds(ms);
            });

            rieussecs.forEach(function(rieussec){
                if (rieussec._cachedState === 'running') {
                    rieussec.start();
                }
            });

            return stopwatches.value[index];
        } else {
            nodecg.log.error('index "%d" sent to "setTime" is out of bounds', index);
            return false;
        }
    }
};

function msToTime(duration) {
    var seconds = parseInt((duration/1000)%60),
        minutes = parseInt((duration/(1000*60))%60),
        hours = parseInt((duration/(1000*60*60))%24);

    hours = (hours < 10) ? '0' + hours : hours;
    minutes = (minutes < 10) ? '0' + minutes : minutes;
    seconds = (seconds < 10) ? '0' + seconds : seconds;

    return hours + ':' + minutes + ':' + seconds;
}
