/**
 * Renderer using PIXI by GoodBoyDigital
 * @moduleName PixiRenderer
 */
bento.define('bento/renderers/pixi', [
    'bento',
    'bento/utils',
    'bento/math/transformmatrix',
    'bento/renderers/canvas2d',
    'bento/eventsystem'
], function (
    Bento,
    Utils,
    TransformMatrix,
    Canvas2d,
    EventSystem
) {
    var PIXI = window.PIXI;
    var SpritePool = function (initialSize) {
        var i;
        // initialize
        this.sprites = [];
        for (i = 0; i < initialSize; ++i) {
            this.sprites.push(new PIXI.Sprite());
        }
        this.index = 0;
    };
    SpritePool.prototype.reset = function () {
        this.index = 0;
    };
    SpritePool.prototype.getSprite = function () {
        var sprite = this.sprites[this.index];
        if (!sprite) {
            sprite = new PIXI.Sprite();
            this.sprites.push(sprite);
        }
        this.index += 1;
        return sprite;
    };
    var GraphicsPool = function (initialSize) {
        var i;
        // initialize
        this.graphics = [];
        for (i = 0; i < initialSize; ++i) {
            this.graphics.push(new PIXI.Graphics());
        }
        this.index = 0;
    };
    GraphicsPool.prototype.reset = function () {
        this.index = 0;
    };
    GraphicsPool.prototype.get = function () {
        var graphic = this.graphics[this.index];
        if (!graphic) {
            graphic = new PIXI.Graphics();
            this.graphics.push(graphic);
        }
        this.index += 1;
        graphic.clear();
        return graphic;
    };

    return function (canvas, settings) {
        var gl;
        var canWebGl = (function () {
            // try making a canvas
            try {
                gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                return !!window.WebGLRenderingContext;
            } catch (e) {
                return false;
            }
        })();
        var matrix;
        var Matrix;
        var matrices = [];
        var alpha = 1;
        var color = 0xFFFFFF;
        var pixiRenderer;
        var spriteRenderer;
        var meshRenderer;
        var graphicsRenderer;
        var particleRenderer;
        var test = false;
        var cocoonScale = 1;
        var pixelSize = settings.pixelSize || 1;
        var tempDisplayObjectParent = null;
        var spritePool = new SpritePool(2000);
        var graphicsPool = new GraphicsPool(500);
        var imgTexMap = [];
        var guidImgMap = [];
        var transformObject = {
            worldTransform: null,
            worldAlpha: 1,
            children: []
        };
        var getPixiMatrix = function () {
            var pixiMatrix = new PIXI.Matrix();
            pixiMatrix.a = matrix.a;
            pixiMatrix.b = matrix.b;
            pixiMatrix.c = matrix.c;
            pixiMatrix.d = matrix.d;
            pixiMatrix.tx = matrix.tx;
            pixiMatrix.ty = matrix.ty;
            return pixiMatrix;
        };
        var getFillGraphics = function (color) {
            var graphics = graphicsPool.get();
            var colorInt = color[2] * 255 + (color[1] * 255 << 8) + (color[0] * 255 << 16);
            var alphaColor = color[3];
            graphics.beginFill(colorInt, alphaColor);
            graphics.worldTransform = getPixiMatrix();
            graphics.worldAlpha = alpha;
            return graphics;
        };
        var renderer = {
            name: 'pixi',
            init: function () {

            },
            destroy: function () {},
            save: function () {
                matrices.push(matrix.clone());
            },
            restore: function () {
                matrix = matrices.pop();
            },
            setTransform: function (a, b, c, d, tx, ty) {
                matrix.a = a;
                matrix.b = b;
                matrix.c = c;
                matrix.d = d;
                matrix.tx = tx;
                matrix.ty = ty;
            },
            getTransform: function () {
                return matrix;
            },
            translate: function (x, y) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.translate(x, y));
            },
            scale: function (x, y) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.scale(x, y));
            },
            rotate: function (angle) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.rotate(angle));
            },
            fillRect: function (color, x, y, w, h) {
                var graphics = getFillGraphics(color);
                graphics.drawRect(x, y, w, h);

                pixiRenderer.setObjectRenderer(graphicsRenderer);
                graphicsRenderer.render(graphics);
            },
            fillCircle: function (color, x, y, radius) {
                var graphics = getFillGraphics(color);
                graphics.drawCircle(x, y, radius);

                pixiRenderer.setObjectRenderer(graphicsRenderer);
                graphicsRenderer.render(graphics);

            },
            strokeRect: function (color, x, y, w, h, lineWidth) {
                var graphics = graphicsPool.get();
                var colorInt = color[2] * 255 + (color[1] * 255 << 8) + (color[0] * 255 << 16);
                var alphaColor = color[3];
                graphics.worldTransform = getPixiMatrix();
                graphics.worldAlpha = alpha;

                graphics.lineStyle(lineWidth, colorInt, alphaColor);
                graphics.drawRect(x, y, w, h);

                pixiRenderer.setObjectRenderer(graphicsRenderer);
                graphicsRenderer.render(graphics);
            },
            strokeCircle: function (color, x, y, radius, sAngle, eAngle, lineWidth) {
                var graphics = graphicsPool.get();
                var colorInt = color[2] * 255 + (color[1] * 255 << 8) + (color[0] * 255 << 16);
                var alphaColor = color[3];
                graphics.worldTransform = getPixiMatrix();
                graphics.worldAlpha = alpha;

                graphics
                    .lineStyle(lineWidth, colorInt, alphaColor)
                    .arc(x, y, radius, sAngle, eAngle);

                pixiRenderer.setObjectRenderer(graphicsRenderer);
                graphicsRenderer.render(graphics);

            },
            drawLine: function (color, ax, ay, bx, by, width) {
                var graphics = getFillGraphics(color);
                var colorInt = color[2] * 255 + (color[1] * 255 << 8) + (color[0] * 255 << 16);

                if (!Utils.isDefined(width)) {
                    width = 1;
                }
                if (!Utils.isDefined(color[3])) {
                    color[3] = 1;
                }

                graphics
                    .lineStyle(width, colorInt, color[3])
                    .moveTo(ax, ay)
                    .lineTo(bx, by)
                    .endFill();

                pixiRenderer.setObjectRenderer(graphicsRenderer);
                graphicsRenderer.render(graphics);
            },
            drawImage: function (packedImage, sx, sy, sw, sh, x, y, w, h) {
                var image = packedImage.image;
                var px = packedImage.x;
                var py = packedImage.y;
                var rectangle;
                var sprite = spritePool.getSprite();
                var texture;
                // If image and frame size don't correspond Pixi will throw an error and break the game.
                // This check tries to prevent that.
                if (px + sx + sw > image.width || py + sy + sh > image.height) {
                    console.error("Warning: image and frame size do not correspond.", image);
                    return;
                }

                if (image.__texGuid === undefined) {
                    texture = new PIXI.Texture(new PIXI.BaseTexture(image, Bento.getAntiAlias() ? PIXI.SCALE_MODES.LINEAR : PIXI.SCALE_MODES.NEAREST));
                    image.__texGuid = imgTexMap.length;
                    imgTexMap[image.__texGuid] = texture;
                    guidImgMap[image.__texGuid] = image;
                    console.log('PIXI texture cache size:' + imgTexMap.length);
                } else if (image.__resetTexture) {
                    texture = new PIXI.Texture(new PIXI.BaseTexture(image, Bento.getAntiAlias() ? PIXI.SCALE_MODES.LINEAR : PIXI.SCALE_MODES.NEAREST));
                    imgTexMap[image.__texGuid].destroy();
                    imgTexMap[image.__texGuid] = texture;
                    image.__resetTexture = false;
                }
                // without spritepool
                /*
                rectangle = new PIXI.Rectangle(px + sx, py + sy, sw, sh);
                texture = new PIXI.Texture(image.texture, rectangle);
                texture._updateUvs();
                sprite = new PIXI.Sprite(texture);
                */

                // with spritepool
                texture = imgTexMap[image.__texGuid];
                rectangle = texture._frame;
                rectangle.x = px + sx;
                rectangle.y = py + sy;
                rectangle.width = sw;
                rectangle.height = sh;
                texture._updateUvs();
                sprite._texture = texture;

                // apply x, y, w, h
                renderer.save();
                renderer.translate(x, y);
                renderer.scale(w / sw, h / sh);

                sprite.worldTransform = matrix;
                sprite.worldAlpha = alpha;

                // push into batch
                pixiRenderer.setObjectRenderer(spriteRenderer);
                spriteRenderer.render(sprite);

                renderer.restore();

                // did the spriteRenderer flush in the meantime?
                if (spriteRenderer.currentBatchSize === 0) {
                    // the spritepool can be reset as well then
                    spritePool.reset();
                    graphicsPool.reset();
                }
            },
            begin: function () {
                spriteRenderer.start();
                if (pixelSize !== 1 || Utils.isCocoonJs()) {
                    this.save();
                    this.scale(pixelSize * cocoonScale, pixelSize * cocoonScale);
                }
            },
            flush: function () {
                // note: only spriterenderer has an implementation of flush
                spriteRenderer.flush();
                spritePool.reset();
                graphicsPool.reset();
                if (pixelSize !== 1 || Utils.isCocoonJs()) {
                    this.restore();
                }
                if (imgTexMap.length >= 50) {
                    console.warn('storing too many textures! clearing automatically');
                    renderer.clearTextures();
                }
            },
            getOpacity: function () {
                return alpha;
            },
            setOpacity: function (value) {
                alpha = value;
            },
            /*
             * Pixi only feature: draws any pixi displayObject
             */
            drawPixi: function (displayObject) {
                // trick the renderer by setting our own parent
                transformObject.worldTransform = matrix;
                transformObject.worldAlpha = alpha;

                // method 1, replace the "parent" that the renderer swaps with
                // maybe not efficient because it calls flush all the time?
                // pixiRenderer._tempDisplayObjectParent = transformObject;
                // pixiRenderer.render(displayObject);

                // method 2, set the object parent and update transform
                displayObject.parent = transformObject;
                displayObject.updateTransform();
                displayObject.renderWebGL(pixiRenderer);
            },
            getContext: function () {
                return gl;
            },
            getPixiRenderer: function () {
                return pixiRenderer;
            },
            // pixi specific: update the webgl view, needed if the canvas changed size
            updateSize: function () {
                pixiRenderer.resize(canvas.width, canvas.height);
            },
            clearTextures: function () {
                var i;
                for (i = 0; i < guidImgMap.length; i++) {
                    imgTexMap[i].destroy();
                    guidImgMap[i].__texGuid = undefined;

                    delete guidImgMap[i].__texGuid;
                    delete guidImgMap[i].__resetTexture;
                }
                imgTexMap.length = 0;
                guidImgMap.length = 0;
            }
        };

        EventSystem.on('screenHidden', function () {
            renderer.clearTextures();
        });

        if (canWebGl && Utils.isDefined(window.PIXI)) {
            // init pixi
            // Matrix = PIXI.Matrix;
            matrix = new TransformMatrix();
            // additional scale
            if (Utils.isCocoonJs()) {
                cocoonScale = Utils.getScreenSize().width * window.devicePixelRatio / canvas.width;
                canvas.width *= cocoonScale;
                canvas.height *= cocoonScale;
            }
            pixiRenderer = new PIXI.WebGLRenderer(canvas.width, canvas.height, {
                view: canvas,
                backgroundColor: 0x000000,
                clearBeforeRender: false
            });
            pixiRenderer.filterManager.setFilterStack(pixiRenderer.renderTarget.filterStack);
            tempDisplayObjectParent = pixiRenderer._tempDisplayObjectParent;
            spriteRenderer = pixiRenderer.plugins.sprite;
            graphicsRenderer = pixiRenderer.plugins.graphics;
            meshRenderer = pixiRenderer.plugins.mesh;

            return renderer;
        } else {
            if (!window.PIXI) {
                console.log('WARNING: PIXI library is missing, reverting to Canvas2D renderer');
            } else if (!canWebGl) {
                console.log('WARNING: WebGL not available, reverting to Canvas2D renderer');
            }
            return Canvas2d(canvas, settings);
        }
    };
});