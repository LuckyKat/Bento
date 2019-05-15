/**
 * An Entity that helps using a HTML5 2d canvas as Sprite. Its component temporarily takes over
 * the renderer, so any entity that gets attached to the parent will start drawing on the canvas.
 * <br>Exports: Constructor
 * @param {Object} settings - Required, set the width and height
 * @param {Number} settings.width - Width of the canvas (ignored if settings.canvas is set)
 * @param {Number} settings.height - Height of the canvas (ignored if settings.canvas is set)
 * @param {HTML-Canvas-Element} (settings.canvas) - Reference to an existing canvas object. Optional.
 * @param {Number} settings.preventAutoClear - Stops the canvas from clearing every tick
 * @param {Number} settings.pixelSize - size of a pixel (multiplies canvas size)
 * @module bento/canvas
 * @moduleName Canvas
 * @returns Entity
 * @snippet Canvas|constructor
Canvas({
    z: ${1:0},
    width: ${2:64},
    height: ${3:64},
    preventAutoClear: ${4:false}, // prevent canvas from clearing every tick
    pixelSize: ${5:1}, // multiplies internal canvas size
    drawOnce: ${6:false}, // draw canvas only once
    originRelative: new Vector2(${7:0}, ${8:0}),
    components: []
});
 */
bento.define('bento/canvas', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween',
    'bento/packedimage',
    'bento/objectpool',
    'bento/renderers/canvas2d'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    EventSystem,
    Utils,
    Tween,
    PackedImage,
    ObjectPool,
    Canvas2D
) {
    'use strict';
    var canvasPool = new ObjectPool({
        poolSize: 1,
        constructor: function () {
            var canvas = Bento.createCanvas();

            return canvas;
        },
        destructor: function (obj) {
            // clear canvas
            var context = obj.getContext('2d');
            context.clearRect(0, 0, obj.width, obj.height);

            return obj;
        }
    });
    return function (settings) {
        var viewport = Bento.getViewport();
        var i;
        var l;
        var sprite;
        var canvas;
        var context;
        var originalRenderer;
        var renderer;
        var packedImage;
        var origin = new Vector2(0, 0);
        var entity;
        var components;
        var drawn = false;
        // this component swaps the renderer with a Canvas2D renderer (see bento/renderers/canvas2d)
        var component = {
            name: 'rendererSwapper',
            draw: function (data) {
                // draw once
                if (drawn) {
                    return;
                }

                // clear up canvas
                if (!settings.preventAutoClear) {
                    context.clearRect(0, 0, canvas.width, canvas.height);
                }

                // request pixi renderer to reset this texture
               canvas.__resetTexture = true;

                // swap renderer
                originalRenderer = data.renderer;
                data.renderer = renderer;

                // re-apply the origin translation
                data.renderer.save();
                data.renderer.translate(Math.round(origin.x), Math.round(origin.y));
            },
            postDraw: function (data) {
                if (drawn) {
                    return;
                }
                data.renderer.restore();
                // swap back
                data.renderer = originalRenderer;

                // draw once
                if (settings.drawOnce) {
                    drawn = true;
                }
            }
        };

        // init canvas
        if (settings.canvas) {
            canvas = settings.canvas;
        } else {
            canvas = canvasPool.get();
            canvas.width = settings.width;
            canvas.height = settings.height;
        }
        context = canvas.getContext('2d');

        // init renderer
        renderer = new Canvas2D(canvas, {
            pixelSize: settings.pixelSize || 1
        });

        if (settings.origin) {
            origin = settings.origin;
        } else if (settings.originRelative) {
            origin = new Vector2(
                settings.width * settings.originRelative.x,
                settings.height * settings.originRelative.y
            );
        }

        // init sprite
        packedImage = new PackedImage(canvas);
        sprite = new Sprite({
            image: packedImage,
            origin: settings.origin,
            originRelative: settings.originRelative
        });

        // init entity and its components
        // sprite goes before the swapcomponent, otherwise the canvas will never be drawn
        components = [sprite, component];
        // attach any other component in settings
        if (settings.components) {
            for (i = 0, l = settings.components.length; i < l; ++i) {
                components.push(settings.components[i]);
            }
        }
        entity = new Entity({
            z: settings.z,
            name: settings.name || 'canvas',
            position: settings.position,
            components: components,
            family: settings.family,
            init: settings.init
        });

        // public interface
        entity.extend({
            /**
             * Returns the canvas element
             * @function
             * @instance
             * @returns HTML Canvas Element
             * @name getCanvas
             * @snippet #Canvas.getCanvas|CanvasElement
                getCanvas();
             */
            getCanvas: function () {
                return canvas;
            },
            /**
             * Returns the 2d context, to perform manual drawing operations
             * @function
             * @instance
             * @returns HTML Canvas 2d Context
             * @snippet #Canvas.getContext|Context2D
                getContext();
             * @name getContext
             */
            getContext: function () {
                return context;
            },
            /**
             * Get the base64 string of the canvas
             * @function
             * @instance
             * @returns String
             * @name getBase64
             * @snippet #Canvas.getBase64|String
                getBase64();
             */
            getBase64: function () {
                return canvas.toDataURL();
            },
            /**
             * Download the canvas as png (useful for debugging purposes)
             * @function
             * @instance
             * @name downloadImage
             * @snippet #Canvas.downloadImage|debug
                downloadImage();
             */
            downloadImage: function (name) {
                var link = document.createElement("a");
                link.download = name || entity.name;
                link.href = canvas.toDataURL();
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            },
            /**
             * Call this function if you have no intent on attaching the canvas,
             * but you do want to draw on the canvas once
             * @function
             * @instance
             * @name drawOnce
             * @snippet #Canvas.drawOnce|snippet
                drawOnce();
             */
            drawOnce: function (data) {
                if (canvas.isAdded) {
                    Utils.log('This Canvas is already attached, no need to call this function.');
                    return;
                }
                canvas.start(data);
                canvas.draw(data);
            }
        });

        return entity;
    };
});