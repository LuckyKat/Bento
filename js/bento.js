/**
 * Bento module, main entry point to game modules and managers. Start the game by using Bento.setup().
 * After this you have access to all Bento managers:<br>
 * • Bento.assets<br>
 * • Bento.audio<br>
 * • Bento.input<br>
 * • Bento.object<br>
 * • Bento.savestate<br>
 * • Bento.screen<br>
 * <br>Exports: Object
 * @module bento
 * @moduleName Bento
 *
 *
 * @snippet Bento.assets|assets
Bento.assets
 * @snippet Bento.objects|objects
Bento.objects
 * @snippet Bento.saveState|saveState
Bento.saveState
 * @snippet Bento.screens|screens
Bento.screens
 * @snippet Bento.audio|audio
Bento.audio
 *
 * @snippet Bento.assets.getJson|Object
Bento.assets.getJson('${1}');
 * @snippet Bento.assets.hasAsset|Boolean
Bento.assets.hasAsset('${1}', '${2:images}')
 * @snippet Bento.assets.load|Load asset group
Bento.assets.load('${1:groupName}', function (error, groupName) {
    // asset group loaded callback
}, function (loaded, total, assetName) {
    // single asset loaded callback
})
 * @snippet Bento.objects.attach|snippet
Bento.objects.attach(${1:entity});
 * @snippet Bento.objects.remove|snippet
Bento.objects.remove(${1:entity});
 * @snippet Bento.objects.get|Entity/Object
Bento.objects.get('${1}', function (${1:entity}) {
    $2
});
 * @snippet Bento.objects.getByFamily|Entity/Object
Bento.objects.getByFamily('${1}', function (array) {$2});
 *
 * @snippet Bento.audio.playSound|snippet
Bento.audio.playSound('sfx_${1}');
 * @snippet Bento.audio.stopSound|snippet
Bento.audio.stopSound('sfx_${1}');
 * @snippet Bento.audio.playMusic|snippet
Bento.audio.playMusic('bgm_${1}');
 * @snippet Bento.audio.stopAllMusic|snippet
Bento.audio.stopAllMusic();
 * @snippet Bento.audio.setVolume|snippet
Bento.audio.setVolume: function (${1:1}, '${2:name}');
 * @snippet Bento.audio.isPlayingMusic|Boolean
Bento.audio.isPlayingMusic: function ('${1:name}');
 *
 * @snippet Bento.saveState.save|snippet
Bento.saveState.save('${1}', ${2:value});
 * @snippet Bento.saveState.load|Value
Bento.saveState.load('${1}', ${2:defaultValue});
 * @snippet Bento.saveState.add|snippet
Bento.saveState.add('${1}', ${2:value});
 *
 * @snippet Bento.screens.show|snippet
Bento.screens.show('screens/${1:name}');
 * @snippet Bento.screens.getCurrentScreen|Screen
Bento.screens.getCurrentScreen();
 *
 */
bento.define('bento', [
    'bento/utils',
    'bento/lib/domready',
    'bento/eventsystem',
    'bento/managers/asset',
    'bento/managers/input',
    'bento/managers/object',
    'bento/managers/audio',
    'bento/managers/screen',
    'bento/managers/savestate',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/renderer',
    'bento/autoresize'
], function (
    Utils,
    DomReady,
    EventSystem,
    AssetManager,
    InputManager,
    ObjectManager,
    AudioManager,
    ScreenManager,
    SaveState,
    Vector2,
    Rectangle,
    Renderer,
    AutoResize
) {
    'use strict';
    var canvas;
    var renderer;
    var bentoSettings;
    var canvasRatio = 0;
    var windowRatio;
    var gameSpeed = 1;
    var canvasScale = {
        x: 1,
        y: 1
    };
    var smoothing = true;
    var dev = false;
    var gameData = {};
    var viewport = new Rectangle(0, 0, 640, 480);
    /**
     * Set up canvas element if it doesn't exist
     */
    var setupCanvas = function (settings) {
        var parent;
        var pixelSize = settings.pixelSize || 1;

        canvas = settings.canvasElement || document.getElementById(settings.canvasId);

        if (!canvas) {
            // no canvas, create it
            parent = document.getElementById('wrapper');
            if (!parent) {
                // just append it to the document body
                parent = document.body;
            }
            canvas = document.createElement('canvas');
            canvas.id = settings.canvasId;
            parent.appendChild(canvas);
        }
        canvas.width = viewport.width * pixelSize;
        canvas.height = viewport.height * pixelSize;
        canvasRatio = viewport.height / viewport.width;
    };
    /**
     * Setup renderer (2D context or WebGL)
     */
    var setupRenderer = function (settings, onComplete) {
        var rendererName = settings.renderer;
        settings.renderer = settings.renderer ? settings.renderer.toLowerCase() : 'canvas2d';

        // canvas2d and pixi are reserved names
        if (settings.renderer === 'canvas2d') {
            rendererName = 'bento/renderers/canvas2d';
        } else if (settings.renderer === 'pixi3') {
            rendererName = 'bento/renderers/pixi3';
        } else if (settings.renderer === 'pixi' || settings.renderer === 'pixijs' || settings.renderer === 'pixi.js') {
            rendererName = 'bento/renderers/pixi';
        } else if (settings.renderer === 'three' || settings.renderer === 'threejs' || settings.renderer === 'three.js') {
            rendererName = 'bento/renderers/three';
        } else if (settings.renderer === 'auto') {
            // auto renderer is deprecated! use canvas2d or pixi
            console.log('WARNING: auto renderer is deprecated. Please use canvas2d or pixi as renderers.');
            rendererName = 'bento/renderers/canvas2d';
        }
        // setup renderer
        new Renderer(rendererName, canvas, settings, function (rend) {
            console.log('Init ' + rend.name + ' as renderer');
            renderer = rend;

            // set anti aliasing after renderer is created
            smoothing = settings.antiAlias;
            Bento.setAntiAlias(smoothing);

            gameData = Bento.getGameData();
            onComplete();
        });
    };
    /**
     * Callback for responsive resizing
     */
    var performResize = function () {
        var viewport = Bento.getViewport();
        var screenSize = Utils.getScreenSize();
        var pixiRenderer;
        var pixelSize = bentoSettings.pixelSize;
        var minWidth = bentoSettings.responsiveResize.minWidth;
        var maxWidth = bentoSettings.responsiveResize.maxWidth;
        var minHeight = bentoSettings.responsiveResize.minHeight;
        var maxHeight = bentoSettings.responsiveResize.maxHeight;
        var lockedRotation = bentoSettings.responsiveResize.lockedRotation;

        // get scaled screen res
        var canvasDimension = new AutoResize(
            minWidth,
            maxWidth,
            minHeight,
            maxHeight,
            lockedRotation
        );

        // we don't have a canvas?
        if (!canvas) {
            return;
        }

        // set canvas and viewport sizes
        canvas.width = canvasDimension.width * pixelSize;
        canvas.height = canvasDimension.height * pixelSize;
        viewport.width = Math.round(canvasDimension.width);
        viewport.height = Math.round(canvasDimension.height);

        // css fit to height
        if (canvas.style) {
            canvas.style.height = screenSize.height + 'px';
            canvas.style.width = (screenSize.height * (viewport.width / viewport.height)) + 'px';
        }

        // log results
        console.log('Screen size: ' + screenSize.width * window.devicePixelRatio + ' x ' + screenSize.height * window.devicePixelRatio);
        console.log('Game Resolution: ' + canvasDimension.width + ' x ' + canvasDimension.height);

        // final settings
        if (renderer && renderer.updateSize) {
            renderer.updateSize();
        }
        // update input and canvas
        Bento.input.updateCanvas();
        /**
         * Fired when screen resizes
         * @event resize
         * @param {Rectangle} viewport - New viewport size 
         */
        EventSystem.fire('resize', viewport);
        // clear the task id
        resizeTaskId = null;
    };
    var resizeTaskId = null;
    var onResize = function () {
        // start a 100ms timeout, if interupted with a repeat event start over
        if (resizeTaskId != null) {
            window.clearTimeout(resizeTaskId);
        }
        resizeTaskId = window.setTimeout(performResize, 100);
    };
    /**
     * Take screenshots based on events
     * For example pressing a button to take a screenshot, handy for development
     */
    var setScreenshotListener = function (evtName) {
        var takeScreenshot = false;
        // web only
        var downloadImage = function (uri, name) {
            var link = document.createElement("a");
            link.download = name;
            link.href = uri;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        if (navigator.isCocoonJS || window.Windows || window.ejecta) {
            // disable in Cocoon, UWP and Ejecta/tvOS platforms
            return;
        }
        if (!dev) {
            // should be in dev mode to take screenshots (?)
            return;
        }

        EventSystem.on(evtName, function () {
            takeScreenshot = true;
        });
        EventSystem.on('postDraw', function (data) {
            if (takeScreenshot) {
                takeScreenshot = false;
                downloadImage(canvas.toDataURL(), 'screenshot');
            }
        });

    };
    /**
     * Listens to cordova events and pass them to Bento (with exception of deviceready)
     */
    var forwardCordovaEvents = function () {
        if (document && document.addEventListener) {
            document.addEventListener('pause', function (evt) {
                /**
                 * The pause event fires when the native platform puts the application into the background, 
                 * typically when the user switches to a different application.
                 * @event cordova-pause 
                 */
                EventSystem.fire('cordova-pause', evt);
            }, false);
            document.addEventListener('resume', function (evt) {
                /**
                 * @event cordova-resume 
                 */
                EventSystem.fire('cordova-resume', evt);
            }, false);
            document.addEventListener('resign', function (evt) {
                /**
                 * (iOS only) The iOS-specific resign event is available as an alternative to pause, and detects when users 
                 * enable the Lock button to lock the device with the app running in the foreground. If 
                 * the app (and device) is enabled for multi-tasking, this is paired with a subsequent 
                 * pause event, but only under iOS 5. In effect, all locked apps in iOS 5 that have multi-tasking 
                 * enabled are pushed to the background. For apps to remain running when locked under iOS 5, disable 
                 * the app's multi-tasking by setting UIApplicationExitsOnSuspend to YES. To run when locked on iOS 4, 
                 * this setting does not matter.
                 * @event cordova-resign 
                 */
                EventSystem.fire('cordova-resign', evt);
            }, false);
            document.addEventListener('backbutton', function (evt) {
                /**
                 * (Android+Windows only) The event fires when the user presses the back button. 
                 * @event cordova-backbutton 
                 */
                EventSystem.fire('cordova-backbutton', evt);
            }, false);
            document.addEventListener('menubutton', function (evt) {
                /**
                 * (Android only) The event fires when the user presses the menu button.
                 * @event cordova-menubutton 
                 */
                EventSystem.fire('cordova-menubutton', evt);
            }, false);
            document.addEventListener('searchbutton', function (evt) {
                /**
                 * (Android only) The event fires when the user presses the search button on Android.
                 * @event cordova-searchbutton 
                 */
                EventSystem.fire('cordova-searchbutton', evt);
            }, false);
            document.addEventListener('volumedownbutton', function (evt) {
                /**
                 * (Android only) The event fires when the user presses the volume down button.
                 * @event cordova-volumedownbutton 
                 */
                EventSystem.fire('cordova-volumedownbutton', evt);
            }, false);
            document.addEventListener('volumeupbutton', function (evt) {
                /**
                 * (Android only) The event fires when the user presses the volume down button.
                 * @event cordova-volumeupbutton 
                 */
                EventSystem.fire('cordova-volumeupbutton', evt);
            }, false);
            document.addEventListener('activated', function (evt) {
                /**
                 * (Windows only) The event fires when Windows Runtime activation has occurred.
                 * @event cordova-activated 
                 */
                EventSystem.fire('cordova-activated', evt);
            }, false);
        }

    };
    /**
     * Main module
     */
    var Bento = {
        // version is updated by build, edit package.json
        version: '1.0.0',
        /**
         * Setup game. Initializes all Bento managers.
         * @name setup
         * @function
         * @instance
         * @param {Object} settings - settings for the game
         * @param {Object} [settings.assetGroups] - Asset groups to load. Key: group name, value: path to json file. See {@link module:bento/managers/asset#loadAssetGroups}
         * @param {String} settings.renderer - Renderer to use. Defaults to "canvas2d". To use "pixi", include the pixi.js file manually. Make sure to download v3!.
         * @param {Rectangle} settings.canvasDimension - base resolution for the game. Tip: use a bento/autoresize rectangle.
         * @param {Boolean} settings.sortMode - Bento Object Manager sorts objects by their z value. See {@link module:bento/managers/object#setSortMode}
         * @param {Boolean} settings.subPixel - Disable rounding of pixels
         * @param {Number} settings.pixelSize - Defaults to 1. You may resize pixels by setting this value. A kind of cheating with pixelart games.
         * @param {Boolean} settings.preventContextMenu - Stops the context menu from appearing in browsers when using right click
         * @param {Boolean} settings.autoDisposeTextures - Removes all internal textures on screen ends to reduce memory usage
         * @param {Object} settings.responsiveResize - Bento's strategy of resizing to mobile screen sizes. 
         * In case of portrait: Bento locks the  min height and fills the width by aspect ratio until the max width is reached. If min width is reached, the height is then adapted by aspect ratio up to it's defined maximum.
         * @param {Number} settings.responsiveResize.minWidth - Minimum width in portrait.
         * @param {Number} settings.responsiveResize.maxWidth - Maximum width in portrait.
         * @param {Number} settings.responsiveResize.minHeight - Minimum height in portrait.
         * @param {Number} settings.responsiveResize.maxHeight - Maximum height in portrait.
         * @param {String} settings.responsiveResize.lockedRotation - 'portrait' or 'landscape' enforces an aspect ratio corrseponding to this, instead of handling this automatically, unnecessary to be used if enforcable by another means
         * @param {Object} settings.reload - Settings for module reloading, set the event names for Bento to listen
         * @param {String} settings.reload.simple - Event name for simple reload: reloads modules and resets current screen
         * @param {String} settings.reload.assets - Event name for asset reload: reloads modules and all assets and resets current screen
         * @param {String} settings.reload.jump - Event name for screen jump: asks user to jumps to a screen
         * @param {Boolean} settings.dev - Use dev mode (for now it's only used for deciding between using throws or console.log's). Optional, default is false.
         * @param {Object} settings.screenshot - Event name for taking screenshots
         * @param {Function} settings.onComplete - Called when game is loaded
         */
        setup: function (settings, callback) {
            dev = settings.dev || false;
            Utils.setDev(dev);

            callback = callback || settings.onComplete || settings.onLoad;
            bentoSettings = settings;
            settings.pixelSize = settings.pixelSize || 1;
            settings.sortMode = settings.sortMode || 0;
            DomReady(function () {
                var runGame = function () {
                    Bento.objects.run();
                    if (callback) {
                        callback();
                    }
                };
                if (settings.canvasDimension) {
                    if (settings.canvasDimension.isRectangle) {
                        viewport = settings.canvasDimension || viewport;
                    } else {
                        throw 'settings.canvasDimension must be a rectangle';
                    }
                }
                setupCanvas(settings);
                setupRenderer(settings, function () {
                    if (settings.responsiveResize) {
                        if (settings.responsiveResize === true) {
                            settings.responsiveResize = {};
                        }
                        settings.responsiveResize.landscape = settings.responsiveResize.landscape || false;
                        settings.responsiveResize.minWidth = settings.responsiveResize.minWidth || 180;
                        settings.responsiveResize.maxWidth = settings.responsiveResize.maxWidth || 240;
                        settings.responsiveResize.minHeight = settings.responsiveResize.minHeight || 320;
                        settings.responsiveResize.maxHeight = settings.responsiveResize.maxHeight || 390;

                        window.addEventListener('resize', onResize, false);
                        window.addEventListener('orientationchange', onResize, false);
                        onResize();
                    }

                    Bento.input = new InputManager(gameData, settings);
                    Bento.objects = new ObjectManager(Bento.getGameData, settings);
                    Bento.assets = new AssetManager(settings);
                    Bento.audio = new AudioManager(Bento);
                    Bento.screens = new ScreenManager(settings);

                    // mix functions
                    Utils.extend(Bento, Bento.objects);

                    if (settings.assetGroups) {
                        Bento.assets.loadAssetGroups(settings.assetGroups, runGame);
                    } else if (window.assetsJson) {
                        // if there is an inline assets.json, load that
                        Bento.assets.loadInlineAssetsJson();
                        runGame();
                    } else {
                        // try loadings assets.json from the root folder
                        Bento.assets.loadAssetsJson(function (error) {
                            runGame();
                        });
                    }
                    // start watching for new modules
                    bento.watch();
                    // reload keys
                    if (settings.reload && settings.dev) {
                        if (settings.reload.simple) {
                            EventSystem.on(settings.reload.simple, function () {
                                Bento.reload();
                            });
                        }
                        if (settings.reload.assets) {
                            EventSystem.on(settings.reload.assets, function () {
                                Bento.assets.loadAssetsJson(function (error) {
                                    Bento.assets.reload(Bento.reload);
                                });
                            });
                        }
                        if (settings.reload.jump) {
                            EventSystem.on(settings.reload.jump, function () {
                                var res = window.prompt('Show which screen?');
                                Bento.screens.show(res);
                            });
                        }
                    }

                    // screenshot key
                    if (settings.screenshot && settings.dev) {
                        setScreenshotListener(settings.screenshot);
                    }
                });
            });

            forwardCordovaEvents();
        },
        /**
         * Returns the settings object supplied to Bento.setup
         * @function
         * @instance
         * @returns Object
         * @name getSettings
         */
        getSettings: function () {
            return bentoSettings;
        },
        /**
         * Returns the current viewport (reference).
         * The viewport is a Rectangle.
         * viewport.x and viewport.y indicate its current position in the world (upper left corner)
         * viewport.width and viewport.height can be used to determine the size of the canvas
         * @function
         * @instance
         * @returns Rectangle
         * @name getViewport
         * @snippet Bento.getViewport|Rectangle
            Bento.getViewport();
         */
        getViewport: function () {
            return viewport;
        },
        /**
         * Returns the canvas element
         * @function
         * @instance
         * @returns HTML Canvas Element
         * @name getCanvas
         */
        getCanvas: function () {
            return canvas;
        },
        /**
         * Returns the current renderer engine
         * @function
         * @instance
         * @returns Renderer
         * @name getRenderer
         */
        getRenderer: function () {
            return renderer;
        },
        /**
         * Reloads modules and jumps to screen. If no screenName was passed,
         * it reloads the current screen.
         * @function
         * @instance
         * @param {String} screenName - screen to show
         * @name reload
         */
        reload: function (screenName) {
            var currentScreen;
            if (!Bento.screens) {
                throw 'Bento has not beens started yet.';
            }
            currentScreen = Bento.screens.getCurrentScreen();

            if (!currentScreen) {
                console.log('WARNING: No screen has been loaded.');
                return;
            }

            Bento.screens.reset();
            Bento.objects.resume();

            Bento.objects.stop();
            bento.refresh();

            // reset game speed
            Bento.objects.throttle = 1;
            gameSpeed = 1;

            // reload current screen
            Bento.screens.show(
                screenName || currentScreen.name,
                undefined,
                function () {
                    // restart the mainloop
                    Bento.objects.run();
                    /**
                     * Fired when using Bento's quick reload feature, <em>after</em> the new screen was shown.
                     * @event bentoReload
                     */
                    EventSystem.fire('bentoReload', {});
                }
            );
        },
        /**
         * Returns a gameData object
         * A gameData object is passed through every object during the update and draw
         * and contains all necessary information to render
         * @function
         * @instance
         * @returns {Object} data
         * @returns {HTMLCanvas} data.canvas - Reference to the current canvas element
         * @returns {Renderer} data.renderer - Reference to current Renderer
         * @returns {Vector2} data.canvasScale - Reference to current canvas scale
         * @returns {Rectangle} data.viewport - Reference to viewport object
         * @returns {Entity} data.entity - The current entity passing the data object
         * @returns {Number} data.deltaT - Time passed since last tick
         * @returns {Number} data.throttle - Game speed (1 is normal)
         * @name getGameData
         * @snippet Bento.getGameData|GameData
            Bento.getGameData();
         */
        getGameData: function () {
            var throttle = Bento.objects ? Bento.objects.throttle : 1;
            return {
                canvas: canvas,
                renderer: renderer,
                canvasScale: canvasScale,
                viewport: viewport,
                entity: null,
                event: null,
                deltaT: 0,
                speed: throttle * gameSpeed
            };
        },
        /**
         * Gets the current game speed
         * @function
         * @instance
         * @returns Number
         * @name getGameSpeed
         * @snippet Bento.getGameSpeed|Number
            Bento.getGameSpeed();
         */
        getGameSpeed: function () {
            return gameSpeed;
        },
        /**
         * Sets the current game speed. Defaults to 1.
         * @function
         * @instance
         * @param {Number} speed - Game speed
         * @returns Number
         * @name setGameSpeed
         * @snippet Bento.setGameSpeed|snippet
            Bento.setGameSpeed(${1:1});
         */
        setGameSpeed: function (value) {
            gameSpeed = value;
        },
        /**
         * Is game in dev mode?
         * @function
         * @instance
         * @returns Boolean
         * @name isDev
         */
        isDev: function () {
            return dev;
        },
        /**
         * Set anti alias. On Web platforms with 2d canvas, this settings applies to the main canvas.
         * In case of ThreeJs, the Sprite component will generate Textures with either THREE.NearestFilter or THREE.LinearFilter
         * @function
         * @instance
         * @param {Boolean} [antiAliasing] - Set anti aliasing
         * @name setAntiAlias
         * @snippet Bento.setAntiAlias|CanvasElement
        Bento.setAntiAlias(${1:true})
         */
        setAntiAlias: function (antiAlias) {
            var context;
            if (!Utils.isDefined(antiAlias)) {
                // undefined as parameter is ignored
                return;
            }
            smoothing = antiAlias;
            if (renderer) {
                // alternatively set on 2d canvas
                context = renderer.getContext();
                if (context && context.canvas) {
                    context.imageSmoothingEnabled = antiAlias;
                    context.webkitImageSmoothingEnabled = antiAlias;
                    context.mozImageSmoothingEnabled = antiAlias;
                    context.msImageSmoothingEnabled = antiAlias;
                }
            }
        },
        /**
         * Get current anti aliasing setting
         * @function
         * @instance
         * @name getAntiAlias
         * @snippet Bento.getAntiAlias|Boolean
        Bento.getAntiAlias()
         */
        getAntiAlias: function () {
            return smoothing;
        },
        /**
         * Wrapper for document.createElement('canvas')
         * @function
         * @instance
         * @name createCanvas
         * @snippet Bento.createCanvas|CanvasElement
        Bento.createCanvas()
         */
        createCanvas: function (antiAlias) {
            var newCanvas = document.createElement('canvas');

            return newCanvas;
        },
        /**
         * Asset manager
         * @see module:bento/managers/asset
         * @instance
         * @name assets
         */
        assets: null,
        /**
         * Object manager
         * @see module:bento/managers/object
         * @instance
         * @name objects
         */
        objects: null,
        /**
         * Input manager
         * @see module:bento/managers/input
         * @instance
         * @name objects
         */
        input: null,
        /**
         * Audio manager
         * @see module:bento/managers/audio
         * @instance
         * @name audio
         */
        audio: null,
        /**
         * Screen manager
         * @see module:bento/managers/screen
         * @instance
         * @name screen
         */
        screens: null,
        /**
         * SaveState manager
         * @see module:bento/managers/savestate
         * @instance
         * @name saveState
         */
        saveState: SaveState,
        utils: Utils
    };
    return Bento;
});