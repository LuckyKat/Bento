/**
 * An entity that displays text from a system font or ttf font. Be warned: drawing text is an expensive operation.
 * This module caches the drawn text as a speed boost, however if you are updating the text all the time this
 * speed boost is cancelled.
 * <br>Exports: Constructor
 * @param {Object} settings - Required, can include Entity settings
 * @param {String} settings.text - String to set as text
 * @param {String} settings.font - Name of the font
 * @param {Number} [settings.fontSize] - Font size in pixels
 * @param {String} [settings.fontColor] - Color of the text (CSS color specification)
 * @param {String} [settings.align] - Alignment: left, center, right (also sets the origin)
 * @param {String} [settings.textBaseline] - Text baseline: bottom, middle, top (also sets the origin)
 * @param {Vector2} [settings.margin] - Expands the canvas (only useful for fonts that have letters that are too large to draw)
 * @param {Number} [settings.ySpacing] - Additional vertical spacing between line breaks
 * @param {Number} [settings.sharpness] - In Chrome the text can become blurry when centered. As a workaround, sharpness acts as extra scale (1 for normal, defaults to 4)
 * @param {Number/Array} [settings.lineWidth] - Line widths (must be set when using strokes), can stroke multiple times
 * @param {String/Array} [settings.strokeStyle] - CSS stroke style
 * @param {Bool/Array} [settings.innerStroke] - Whether the particular stroke should be inside the text
 * @param {Bool} [settings.pixelStroke] - Cocoon.io's canvas+ has a bug with text strokes. This is a workaround that draws a stroke by drawing the text multiple times.
 * @param {Bool} [settings.antiAlias] - Set anti aliasing on text (Cocoon only)
 * @param {Boolean} [settings.shadow] - Draws a shadow under the text
 * @param {Vector2} [settings.shadowOffset] - Offset of shadow
 * @param {String} [settings.shadowColor] - Color of the shadow (CSS color specification)
 * @param {Number} [settings.maxWidth] - Maximum width for the text. If the the text goes over this, it will first start adding linebreaks. If that doesn't help it will start scaling ifself down. Use null to reset maxWidth.
 * @param {Number} [settings.maxHeight] - Maximum height for the text. If the the text goes over this, it will start scaling itself down. Use null to reset maxHeight.
 * @param {Number} [settings.linebreaks] - Allow the module to add linebreaks to fit text with maxWidth (default true)
 * @param {Boolean} [settings.drawDebug] - Draws the maxWidth and maxHeight as a box. Also available as static value Text.drawDebug, affecting every Text object.
 * @module bento/gui/text
 * @moduleName Text
 * @snippet Text|constructor
Text({
    z: ${1:0},
    position: new Vector2(${2:0}, ${3:0}),
    text: '${4}',
    font: '${5:font}',
    fontSize: ${6:16},
    fontColor: '${7:#ffffff}',
    align: '${8:left}',
    textBaseline: '${9:bottom}',
    ySpacing: ${10:0},
    lineWidth: ${11:0}, // set to add an outline
    strokeStyle: '${12:#000000}',
    innerStroke: ${13:false},
    pixelStroke: ${14:true}, // workaround for Cocoon bug
    antiAlias: ${14:true}, // Cocoon only
    maxWidth: ${15:undefined},
    maxHeight: ${16:undefined},
    linebreaks: ${17:true},
    drawDebug: ${18:false},
    components: [$19]
});
 * @returns Entity
 */
bento.define('bento/gui/text', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/entity',
    'bento/utils',
    'bento/components/sprite',
    'bento/packedimage'
], function (
    Bento,
    Vector2,
    Rectangle,
    Entity,
    Utils,
    Sprite,
    PackedImage
) {
    'use strict';
    var isEmpty = function (obj) {
        var temp;
        if (obj === "" || obj === 0 || obj === "0" || obj === null ||
            obj === false || !Utils.isDefined(obj)) {
            return true;
        }
        //  Check if the array is empty
        if (Utils.isArray(obj) && obj.length === 0) {
            return true;
        }
        //  Check if the object is empty
        if (Utils.isObject(obj)) {
            for (temp in obj) {
                if (Utils.has(obj, temp)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    };

    var Text = function (settings) {
        /*settings = {
            font: string,
            align: string,
            textBaseline: string,
            margin: vector,
            fontColor: string ,
            lineWidth: number or array,
            strokeStyle: string or array,
            innerStroke: boolean or array,
            pixelStroke: boolean, // for the Cocoon strokeText bug
            fontSize: number,
            ySpacing: number,
            position: vector
        }*/
        var text = '';
        var linebreaks = true;
        var linebreaksOnlyOnSpace = false;
        var maxWidth;
        var maxHeight;
        var fontWeight = 'normal';
        var gradient;
        var gradientColors = ['black', 'white'];
        var align = 'left';
        var font = 'arial';
        var fontSize = 16;
        var originalFontSize = 32;
        var fontColor = 'black';
        var lineWidth = [0];
        var maxLineWidth = 0;
        var lineJoin = 'round';
        var strokeStyle = ['black'];
        var strokeOffset = [new Vector2(0, 0)];
        var innerStroke = [false];
        var textBaseline = 'top';
        var pixelStroke = false;
        var centerByCanvas = false; // quick fix
        var strings = [];
        var spaceWidth = 0;
        var ySpacing = 0;
        var overlaySprite = null;
        var canvas;
        var ctx;
        var packedImage;
        var canvasWidth = 1;
        var canvasHeight = 1;
        var compositeOperation = 'source-over';
        var sharpness = Text.defaultSharpness; // extra scaling to counter blurriness in chrome
        var invSharpness = 1 / sharpness;
        var margin = new Vector2(0, 0);
        var fontSizeCache = {};
        var antiAliasing; // do not set a default value here
        var drawDebug = settings.drawDebug || false;
        var shadow = false;
        var shadowOffset = new Vector2(0, 0);
        var shadowOffsetMax = 0;
        var shadowColor = 'black';
        var didWarn = false;
        var warningCounter = 0;
        /*
         * Prepare font settings, gradients, max width/height etc.
         */
        var applySettings = function (textSettings) {
            var i,
                l,
                maxLength;

            // apply fontSettings
            if (textSettings.fontSettings) {
                Utils.extend(textSettings, textSettings.fontSettings);
            }

            // patch for blurry text in chrome
            if (textSettings.sharpness) {
                sharpness = textSettings.sharpness;
                invSharpness = 1 / sharpness;
                scaler.scale.x = invSharpness;
                scaler.scale.y = invSharpness;
            }
            if (textSettings.fontSize) {
                textSettings.fontSize *= sharpness;
            }

            /*
             * Gradient settings
             * overwrites fontColor behavior
             */
            if (textSettings.gradient) {
                gradient = textSettings.gradient;
            }
            if (textSettings.gradientColors) {
                gradientColors = [];
                for (i = 0, l = textSettings.gradientColors.length; i < l; ++i) {
                    gradientColors[i] = textSettings.gradientColors[i];
                }
            }
            if (textSettings.overlaySprite) {
                overlaySprite = textSettings.overlaySprite;
                if (!overlaySprite.initialized) {
                    overlaySprite.init();
                    overlaySprite.initialized = true;
                }
            }
            /*
             * Alignment settings
             */
            if (textSettings.align) {
                align = textSettings.align;
            }
            if (Utils.isDefined(textSettings.ySpacing)) {
                ySpacing = textSettings.ySpacing * sharpness;
            }
            /*
             * Font settings
             */
            if (textSettings.font) {
                font = textSettings.font;
            }
            if (Utils.isDefined(textSettings.fontSize)) {
                fontSize = textSettings.fontSize;
                originalFontSize = fontSize;
            }
            if (textSettings.fontColor) {
                fontColor = textSettings.fontColor;
            }
            if (textSettings.textBaseline) {
                textBaseline = textSettings.textBaseline;
            }
            if (textSettings.centerByCanvas) {
                centerByCanvas = textSettings.centerByCanvas;
            }
            if (Utils.isDefined(textSettings.fontWeight)) {
                fontWeight = textSettings.fontWeight;
            }
            /*
             * Stroke settings
             * Sets a stroke over the text. You can apply multiple strokes by
             * supplying an array of lineWidths / strokeStyles
             * By default, the strokes are outlines, you can create inner strokes
             * by setting innerStroke to true (for each stroke by supplying an array).
             *
             * lineWidth: {Number / Array of Numbers} width of linestroke(s)
             * strokeStyle: {strokeStyle / Array of strokeStyles} A strokestyle can be a
             *              color string, a gradient object or pattern object
             * innerStroke: {Boolean / Array of booleans} True = stroke becomes an inner stroke, false by default
             */
            if (Utils.isDefined(textSettings.lineWidth)) {
                if (!Utils.isArray(textSettings.lineWidth)) {
                    lineWidth = [textSettings.lineWidth * sharpness];
                } else {
                    lineWidth = textSettings.lineWidth;
                    Utils.forEach(lineWidth, function (item, i, l, breakLoop) {
                        lineWidth[i] *= sharpness;
                    });
                }
            }
            if (textSettings.strokeStyle) {
                if (!Utils.isArray(textSettings.strokeStyle)) {
                    strokeStyle = [textSettings.strokeStyle];
                } else {
                    strokeStyle = textSettings.strokeStyle;
                }
            }
            if (Utils.isDefined(textSettings.strokeOffset)) {
                if (!Utils.isArray(textSettings.strokeStyle)) {
                    strokeOffset = [textSettings.strokeOffset.scalarMultiply(sharpness)];
                } else {
                    strokeOffset = [];
                    Utils.forEach(textSettings.strokeOffset, function (offset) {
                        strokeOffset.push(offset.scalarMultiply(sharpness));
                    });
                }
            }
            if (textSettings.innerStroke) {
                if (!Utils.isArray(textSettings.innerStroke)) {
                    innerStroke = [textSettings.innerStroke];
                } else {
                    innerStroke = textSettings.innerStroke;
                }
            }
            pixelStroke = textSettings.pixelStroke || false;
            lineJoin = Utils.getDefault(textSettings.lineJoin, 'round');
            // align array lengths
            maxLength = Math.max(lineWidth.length, strokeStyle.length, innerStroke.length);
            while (lineWidth.length < maxLength) {
                lineWidth.push(0);
            }
            while (strokeStyle.length < maxLength) {
                strokeStyle.push('black');
            }
            while (innerStroke.length < maxLength) {
                innerStroke.push(false);
            }
            // find max width
            maxLineWidth = 0;
            for (i = 0, l = lineWidth.length; i < l; ++i) {
                // double lineWidth, because we only do outer/inner
                maxLineWidth = Math.max(maxLineWidth, lineWidth[i] * 2);
            }

            // shadow
            if (Utils.isDefined(textSettings.shadow)) {
                shadow = textSettings.shadow;
                if (Utils.isDefined(textSettings.shadowOffset)) {
                    shadowOffset = textSettings.shadowOffset.scalarMultiply(sharpness);
                } else {
                    if (shadow) {
                        // default is 1 pixel down
                        shadowOffset = new Vector2(0, 1 * sharpness);
                    } else {
                        shadowOffset = new Vector2(0, 0);
                    }
                }
                // get largest offset so we can resize the canvas
                shadowOffsetMax = Math.max(Math.abs(shadowOffset.x), Math.abs(shadowOffset.y));
                shadowColor = textSettings.shadowColor || 'black';
            }

            /*
             * entity settings
             */
            if (Utils.isDefined(textSettings.linebreaks)) {
                linebreaks = textSettings.linebreaks;
            }
            if (Utils.isDefined(textSettings.linebreaksOnlyOnSpace)) {
                linebreaksOnlyOnSpace = textSettings.linebreaksOnlyOnSpace;
            }
            if (Utils.isDefined(textSettings.maxWidth)) {
                maxWidth = textSettings.maxWidth * sharpness;
            }
            if (Utils.isDefined(textSettings.maxHeight)) {
                maxHeight = textSettings.maxHeight * sharpness;
            }
            if (Utils.isDefined(textSettings.margin)) {
                margin = textSettings.margin.scalarMultiply(sharpness);
            }

            // set up text
            if (textSettings.text) {
                entity.setText(settings.text);
            } else {
                entity.setText(text);
            }
        };
        var createCanvas = function () {
            var textCanvas;
            if (settings.fontSettings) {
                if (Utils.isDefined(settings.fontSettings.antiAlias)) {
                    antiAliasing = settings.fontSettings.antiAlias;
                }
            } else if (Utils.isDefined(settings.antiAlias)) {
                antiAliasing = settings.antiAlias;
            }

            // (re-)initialize canvas
            textCanvas = Bento.createCanvas(antiAliasing);
            return textCanvas;
        };
        /*
         * Draw text to canvas
         */
        var updateCanvas = function (canvasTarget) {
            var i, ii,
                j, jj,
                l,
                x,
                y,
                scale,
                context,
                // extra offset because we may draw a line around the text
                offset = new Vector2(maxLineWidth / 2, maxLineWidth / 2),
                origin = sprite.origin,
                position = entity.position,
                doPixelStroke = function () {
                    var tempCanvas = document.createElement('canvas');
                    var tempCtx = tempCanvas.getContext('2d');
                    var cache = Bento.getAntiAlias();

                    // set anti alias
                    if (Utils.isDefined(antiAliasing)) {
                        Bento.setAntiAlias(antiAliasing);
                    }
                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;

                    // revert anti alias
                    if (Utils.isDefined(antiAliasing)) {
                        Bento.setAntiAlias(cache);
                    }

                    // copy fillText operation with
                    setContext(tempCtx);
                    tempCtx.fillStyle = strokeStyle[j];
                    tempCtx.fillText(strings[i].string, ~~x, ~~y + (navigator.isCocoonJS ? 0 : 0.5));

                    // draw it 8 times on normal canvas
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, -lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, -lineWidth, -lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, -lineWidth, 0, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, -lineWidth, lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, lineWidth, lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, lineWidth, 0, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, lineWidth, -lineWidth, tempCanvas.width, tempCanvas.height);
                },
                doShadow = function () {
                    var tempCanvas = document.createElement('canvas');
                    var tempCtx = tempCanvas.getContext('2d');
                    var cache = Bento.getAntiAlias();

                    // set anti alias
                    if (Utils.isDefined(antiAliasing)) {
                        Bento.setAntiAlias(antiAliasing);
                    }

                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;

                    // revert anti alias
                    if (Utils.isDefined(antiAliasing)) {
                        Bento.setAntiAlias(cache);
                    }

                    // copy fillText operation with
                    setContext(tempCtx);
                    tempCtx.fillStyle = shadowColor;
                    tempCtx.fillText(strings[i].string, ~~x, ~~y + (navigator.isCocoonJS ? 0 : 0.5));

                    // draw it again on normal canvas
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, shadowOffset.x, shadowOffset.y, tempCanvas.width, tempCanvas.height);
                };

            if (!canvasTarget) {
                if (!canvas) {
                    // generat it first
                    canvas = createCanvas();
                    canvasTarget = canvas;
                    ctx = canvasTarget.getContext('2d');
                }
                // use closure's canvas and context
                canvasTarget = canvas;
                context = ctx;
            } else {
                context = canvasTarget.getContext('2d');
            }

            var cacheAntiAlias = Bento.getAntiAlias();
            // set anti alias (setting width and height will generate a new texture)
            if (Utils.isDefined(antiAliasing)) {
                Bento.setAntiAlias(antiAliasing);
            }

            // resize canvas based on text size
            canvasTarget.width = canvasWidth + maxLineWidth + shadowOffsetMax + margin.x * 2;
            canvasTarget.height = canvasHeight + maxLineWidth + shadowOffsetMax + margin.y * 2;

            // revert anti alias
            if (Utils.isDefined(antiAliasing)) {
                Bento.setAntiAlias(cacheAntiAlias);
            }

            // clear
            context.clearRect(0, 0, canvasTarget.width, canvasTarget.height);
            // update baseobject
            if (canvas === canvasTarget) {
                entity.dimension = new Rectangle(0, 0, canvasTarget.width / sharpness, canvasTarget.height / sharpness);
            }

            if (align === 'center') entity.dimension.x = -entity.dimension.width/2;
            if (align === 'right') entity.dimension.x = -entity.dimension.width;

            if (textBaseline === 'middle') entity.dimension.y = -entity.dimension.height/2;
            if (textBaseline === 'bottom') entity.dimension.y = -entity.dimension.height;

            // TODO: fix this if needed
            // fit overlay onto canvas
            if (overlaySprite) {
                scale = canvasTarget.width / overlaySprite.getDimension().width;
                if (overlaySprite.scalable) {
                    overlaySprite.scalable.setScale(new Vector2(scale, scale));
                }
            }

            // offset text left or up for shadow if needed
            if (shadow) {
                if (shadowOffset.x < 0) {
                    offset.x -= shadowOffset.x;
                }
                if (shadowOffset.y < 0) {
                    offset.y -= shadowOffset.y;
                }
            }

            // set alignment by setting the origin
            if (canvas === canvasTarget) {
                switch (align) {
                case 'left':
                    origin.x = margin.x;
                    break;
                case 'center':
                    origin.x = margin.x + canvasWidth / 2;
                    break;
                case 'right':
                    origin.x = margin.x + canvasWidth;
                    break;
                default:
                    break;
                }
                switch (textBaseline) {
                case 'top':
                    origin.y = margin.y;
                    break;
                case 'middle':
                    origin.y = margin.y + (centerByCanvas ? canvasTarget.height : canvasHeight) / 2;
                    break;
                case 'bottom':
                    origin.y = margin.y + (centerByCanvas ? canvasTarget.height : canvasHeight);
                    break;
                default:
                    break;
                }
            }

            // draw text
            setContext(context);
            for (i = 0, ii = strings.length; i < ii; ++i) {
                // gradient or solid color
                if (Utils.isDefined(strings[i].gradient)) {
                    context.fillStyle = strings[i].gradient;
                } else {
                    context.fillStyle = fontColor;
                }
                // add 1 fontSize because text is aligned to the bottom (most reliable one)
                x = offset.x + origin.x + strings[i].spaceWidth / 2;
                y = offset.y + (i + 1) * fontSize + margin.y + ySpacing * i;

                // outer stroke with pixelStroke
                context.globalCompositeOperation = 'source-over';
                if (pixelStroke) {
                    for (j = lineWidth.length - 1; j >= 0; --j) {
                        if (lineWidth[j] && !innerStroke[j]) {
                            doPixelStroke();
                        }
                    }
                }

                // shadow
                if (shadow) {
                    doShadow();
                }

                // fillText
                context.globalCompositeOperation = 'source-over';
                context.fillText(strings[i].string, ~~x, ~~y + (navigator.isCocoonJS ? 0 : 0.5));


                // pattern
                if (!isEmpty(overlaySprite)) {
                    context.globalCompositeOperation = 'source-atop';
                    overlaySprite.setPosition(new Vector2(x, y - fontSize));
                    overlaySprite.draw({
                        canvas: canvas,
                        context: context
                    });
                }

                // inner stroke
                context.globalCompositeOperation = 'source-atop';
                for (j = 0, jj = lineWidth.length; j < jj; ++j) {
                    if (lineWidth[j] && innerStroke[j]) {
                        context.lineWidth = lineWidth[j] * 2;
                        context.strokeStyle = strokeStyle[j];
                        context.strokeText(strings[i].string, ~~x + strokeOffset[j].x, ~~y + strokeOffset[j].y);
                    }
                }

                // outer stroke
                if (!pixelStroke) {
                    context.lineJoin = lineJoin;
                    context.globalCompositeOperation = 'destination-over';
                    for (j = lineWidth.length - 1; j >= 0; --j) {
                        if (lineWidth[j] && !innerStroke[j]) {
                            context.lineWidth = lineWidth[j] * 2;
                            context.strokeStyle = strokeStyle[j];
                            context.strokeText(strings[i].string, ~~x + strokeOffset[j].x, ~~y + strokeOffset[j].y);
                        }
                    }
                }
            }
            restoreContext(context);

            // delete texture in case of pixi
            if (canvas === canvasTarget) {
                if (canvas.texture && canvas.texture.destroy) {
                    canvas.texture.destroy();
                }
                if (canvas.texture && canvas.texture.dispose) {
                    canvas.texture.dispose();
                }
                canvas.texture = null;
                packedImage = new PackedImage(canvas);
                sprite.setup({
                    image: packedImage
                });
            }

            warningCounter += 2;

            return canvasTarget;
        };
        /*
         * Restore context and previous font settings
         */
        var restoreContext = function (context) {
            if (!context) {
                return;
            }
            context.textAlign = 'left';
            context.textBaseline = 'bottom';
            context.lineWidth = 0;
            context.strokeStyle = 'black';
            context.fillStyle = 'black';
            context.globalCompositeOperation = compositeOperation;
            context.restore();
        };
        /*
         * Save context and set font settings for drawing
         */
        var setContext = function (context) {
            if (!context) {
                return;
            }
            context.save();
            context.textAlign = align;
            context.textBaseline = 'bottom';
            context.font = fontWeight + ' ' + fontSize.toString() + 'px ' + font;
            compositeOperation = context.globalCompositeOperation;
        };
        /*
         * Splits the string into an array per line (canvas does not support
         * drawing of linebreaks in text)
         */
        var setupStrings = function () {
            var singleStrings = ('' + text).split('\n'),
                stringWidth,
                singleString,
                i, j, l,
                calcGrd,
                subString,
                remainingString,
                spacePos,
                extraSpace = false;

            if (!canvas) {
                if (!didInit && !Text.generateOnConstructor) {
                    // first time initialization with text
                    if (!canvas) {
                        canvas = createCanvas();
                        ctx = canvas.getContext('2d');
                    }
                    didInit = true;
                    applySettings(settings);
                }
            }

            strings = [];
            canvasWidth = 1;
            canvasHeight = 1;
            setContext(ctx);
            for (i = 0; i < singleStrings.length; ++i) {
                spaceWidth = 0;
                singleString = singleStrings[i];
                l = singleString.length;
                stringWidth = ctx.measureText(singleString).width;
                // do we need to generate extra linebreaks?
                if (linebreaks && !isEmpty(maxWidth) && stringWidth > maxWidth) {
                    // start cutting off letters until width is correct
                    j = 0;
                    while (stringWidth > maxWidth) {
                        ++j;
                        subString = singleString.slice(0, singleString.length - j);
                        stringWidth = ctx.measureText(subString).width;
                        // no more letters left: assume 1 letter
                        if (j === l) {
                            j = l - 1;
                            break;
                        }
                    }
                    if (!(linebreaksOnlyOnSpace && singleString.indexOf(' ') == -1 && singleString.indexOf('\u200b') == -1) ) {
                        // find first space to split (if there are no spaces, we just split at our current position)
                        spacePos = Math.max(subString.lastIndexOf(' '), subString.lastIndexOf('\u200b'));
                        if (spacePos > 0 && spacePos != subString.length) {
                            // set splitting position
                            j += subString.length - spacePos;
                        } else {
                            if (linebreaksOnlyOnSpace) {
                                j = 0;
                            }
                        }
                        // split the string into 2
                        remainingString = singleString.slice(l - j, l);
                        singleString = singleString.slice(0, l - j);

                        // remove first space in remainingString
                        if (remainingString.charAt(0) === ' ') {
                            remainingString = remainingString.slice(1);
                        }

                        // the remaining string will be pushed into the array right after this one
                        if (remainingString.length !== 0) {
                            singleStrings.splice(i + 1, 0, remainingString);
                        }
                    }

                    // set width correctly and proceed
                    stringWidth = ctx.measureText(singleString).width;
                }

                if (stringWidth > canvasWidth) {
                    canvasWidth = stringWidth;
                }

                calcGrd = calculateGradient(stringWidth, i);
                strings.push({
                    string: singleString,
                    width: stringWidth,
                    gradient: calcGrd,
                    spaceWidth: spaceWidth
                });
                canvasHeight += fontSize + ySpacing;
            }
        };
        /*
         * Prepares the gradient object for every string line
         * @param {Number} width - Gradient width
         * @param {index} index - String index of strings array
         */
        var calculateGradient = function (width, index) {
            var grd,
                startGrd = {
                    x: 0,
                    y: 0
                },
                endGrd = {
                    x: 0,
                    y: 0
                },
                gradientValue,
                i,
                l,
                top,
                bottom;

            if (!gradient) {
                return;
            }

            top = (fontSize + ySpacing) * index;
            bottom = (fontSize + ySpacing) * (index + 1);

            switch (gradient) {
            case 'top-down':
                startGrd.x = 0;
                startGrd.y = top;
                endGrd.x = 0;
                endGrd.y = bottom;
                break;
            case 'down-top':
                startGrd.x = 0;
                startGrd.y = bottom;
                endGrd.x = 0;
                endGrd.y = top;
                break;
            case 'left-right':
                startGrd.x = 0;
                startGrd.y = 0;
                endGrd.x = width;
                endGrd.y = 0;
                break;
            case 'right-left':
                startGrd.x = width;
                startGrd.y = 0;
                endGrd.x = 0;
                endGrd.y = 0;
                break;
            case 'topleft-downright':
                startGrd.x = 0;
                startGrd.y = top;
                endGrd.x = width;
                endGrd.y = bottom;
                break;
            case 'topright-downleft':
                startGrd.x = width;
                startGrd.y = top;
                endGrd.x = 0;
                endGrd.y = bottom;
                break;
            case 'downleft-topright':
                startGrd.x = 0;
                startGrd.y = bottom;
                endGrd.x = width;
                endGrd.y = top;
                break;
            case 'downright-topleft':
                startGrd.x = width;
                startGrd.y = bottom;
                endGrd.x = 0;
                endGrd.y = top;
                break;
            default:
                break;
            }
            // offset with the linewidth
            startGrd.x += maxLineWidth / 2;
            startGrd.y += maxLineWidth / 2;
            endGrd.x += maxLineWidth / 2;
            endGrd.y += maxLineWidth / 2;

            grd = ctx.createLinearGradient(
                startGrd.x,
                startGrd.y,
                endGrd.x,
                endGrd.y
            );
            for (i = 0.0, l = gradientColors.length; i < l; ++i) {
                gradientValue = i * (1 / (l - 1));
                grd.addColorStop(gradientValue, gradientColors[i]);
            }

            return grd;
        };
        var didInit = false;
        var debugDrawComponent = {
            name: 'debugDrawComponent',
            draw: function (data) {
                // draw the debug box while we're at it
                var entity;
                var box;
                var relativeOrigin = new Vector2(0, 0);
                var absoluteOrigin = new Vector2(0, 0);
                if (
                    (Text.drawDebug || drawDebug) &&
                    (maxWidth !== null || maxHeight !== null)
                ) {
                    entity = data.entity;

                    // predict where the origin will be if max is not reached
                    relativeOrigin.x = sprite.origin.x / entity.dimension.width;
                    relativeOrigin.y = sprite.origin.y / entity.dimension.height;
                    absoluteOrigin = sprite.origin.clone();
                    if (maxWidth !== null) {
                        absoluteOrigin.x = relativeOrigin.x * maxWidth;
                    }
                    if (maxHeight !== null) {
                        absoluteOrigin.y = relativeOrigin.y * maxHeight;
                    }

                    box = new Rectangle(
                        absoluteOrigin.x * -1 || 0,
                        absoluteOrigin.y * -1 || 0,
                        maxWidth || entity.dimension.width,
                        maxHeight || entity.dimension.height
                    );
                    data.renderer.fillRect([0, 0, 1, 0.25], box.x, box.y, box.width, box.height);
                    // draw edges
                    if (maxWidth !== null) {
                        data.renderer.drawLine([0, 0, 1, 0.5], box.x, box.y, box.x, box.y + box.height, 1);
                        data.renderer.drawLine([0, 0, 1, 0.5], box.x + box.width, box.y, box.x + box.width, box.y + box.height, 1);
                    }
                    if (maxHeight !== null) {
                        data.renderer.drawLine([0, 0, 1, 0.5], box.x, box.y, box.x + box.width, box.y, 1);
                        data.renderer.drawLine([0, 0, 1, 0.5], box.x, box.y + box.height, box.x + box.width, box.y + box.height, 1);
                    }
                }
            },
            start: function () {
                // re-init canvas
                if (!canvas) {
                    if (!didInit && !Text.generateOnConstructor) {
                        // first time initialization with text
                        if (!canvas) {
                            canvas = createCanvas();
                            ctx = canvas.getContext('2d');
                        }
                        didInit = true;
                        applySettings(settings);
                    } else {
                        // just reinit the canvas
                        updateCanvas();
                    }
                }
            },
            destroy: function () {
                if (Text.disposeCanvas && canvas) {
                    if (canvas.dispose) {
                        // destroy Cocoon texture
                        canvas.dispose();
                    }
                    if (canvas.texture && canvas.texture.destroy) {
                        // destroy PixiJS texture
                        canvas.texture.destroy();
                    }
                    if (canvas.texture && canvas.texture.dispose) {
                        // dispose ThreeJS texture
                        canvas.texture.dispose();
                    }
                    canvas = null;
                    packedImage = null;
                }
            },
            update: function () {
                if (warningCounter) {
                    warningCounter -= 1;
                }
                if (!didWarn && warningCounter > 600 && !Text.suppressWarnings) {
                    didWarn = true;
                    console.warn('PERFORMANCE WARNING: for the past 600 frames this Text module has been updating all the time.', entity);
                }
            }
        };
        var sprite = new Sprite({
            image: packedImage
        });
        var scaler = new Entity({
            name: 'sharpnessScaler',
            scale: new Vector2(invSharpness, invSharpness),
            components: [
                debugDrawComponent,
                sprite
            ]
        });
        var entitySettings = Utils.extend({
            z: 0,
            name: 'text',
            position: new Vector2(0, 0)
        }, settings, true);

        // merge components array
        entitySettings.components = settings.components || [];

        var entity;

        // add the scaler (debugDrawComponent and sprite) as top component
        entitySettings.components = [scaler].concat(entitySettings.components || []);

        entity = new Entity(entitySettings).extend({
            /**
             * Get a reference to the internal canvas
             * @function
             * @instance
             * @name getCanvas
             * @returns HTMLCanvasElement
             */
            getCanvas: function () {
                return canvas;
            },
            /**
             * Retrieve current text
             * @function
             * @instance
             * @name getText
             * @returns String
             * @snippet #Text.getText|String
                getText();
             */
            getText: function () {
                return text;
            },
            /**
             * Get array of the string setup settings
             * @function
             * @instance
             * @name getStrings
             * @snippet #Text.getStrings|Array
                getStrings();
             * @returns Array
             */
            getStrings: function () {
                return strings;
            },
            /**
             * Sets and displays current text
             * @param {String} text - The string you want to set
             * @param {Object} settings (optional) - Apply new settings for text visuals
             * @function
             * @instance
             * @name setText
             * @snippet #Text.setText|snippet
                setText('$1');
             * @snippet #Text.setText|settings
                setText('$1', ${2:{}});
             */
            setText: function (str, settings) {
                var cachedFontSize = 0,
                    hash;
                //reset fontSize
                fontSize = originalFontSize;

                if (settings) {
                    applySettings(settings);
                }
                text = str;
                setupStrings();

                // check maxWidth and maxHeight
                if (!isEmpty(maxWidth) || !isEmpty(maxHeight)) {
                    hash = Utils.checksum(str + '_' + maxWidth + '_' + maxHeight);
                    if (Utils.isDefined(fontSizeCache[hash])) {
                        fontSize = fontSizeCache[hash];
                        setupStrings();
                    } else {
                        while (fontSize > 0 && ((!isEmpty(maxWidth) && canvasWidth > maxWidth) || (!isEmpty(maxHeight) && canvasHeight > maxHeight))) {
                            // try again by reducing fontsize
                            fontSize -= 1;
                            setupStrings();
                        }
                        fontSizeCache[hash] = fontSize;
                    }
                }
                updateCanvas();

                return fontSize / sharpness;
            },
            /**
             * Retrieve the font size that was used to render the text
             * @function
             * @instance
             * @name getEffectiveFontSize
             * @returns Number
             * @snippet #Text.getEffectiveFontSize|Number
                getEffectiveFontSize();
             */
            getEffectiveFontSize: function () {
                return fontSize / sharpness;
            },

            /**
             * Generate text manually (on a seperate canvas)
             * @function
             * @instance
             * @name generateText
             * @returns Canvas
             * @snippet #Text.generateText|Text
                generateText(canvas);
             */
            generateText: function (canvasTarget) {
                applySettings(settings);
                return updateCanvas(canvasTarget);
            },

        });

        if (Text.generateOnConstructor) {
            if (!canvas) {
                canvas = createCanvas();
                ctx = canvas.getContext('2d');
            }
            applySettings(settings);
        }

        return entity;
    };

    // static value drawDebug
    Text.drawDebug = false;

    // clean up internal canvas immediately on destroy
    Text.disposeCanvas = true;

    // legacy setting
    Text.generateOnConstructor = false;

    Text.suppressWarnings = false;

    // static value for default sharpness so it can be applied to all text beforehand
    Text.defaultSharpness = 4;

    return Text;
});
