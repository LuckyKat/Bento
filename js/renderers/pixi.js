/**
 * Renderer using PIXI by GoodBoyDigital
 * @moduleName PixiRenderer
 */
bento.define('bento/renderers/pixi', [
    'bento',
    'bento/utils',
    'bento/math/transformmatrix',
    'bento/renderers/canvas2d'
], function (Bento, Utils, TransformMatrix, Canvas2d) {
    var PIXI = window.PIXI;
    var PixiRenderer = function (canvas, settings) {
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
        var renderer;
        var cocoonScale = 1;
        var pixelSize = settings.pixelSize || 1;
        var pixiMatrix = new PIXI.Matrix();
        var stage = new PIXI.Container();
        var pixiRenderer = {
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
                return;
            },
            fillCircle: function (color, x, y, radius) {
                return;
            },
            strokeRect: function (color, x, y, w, h, lineWidth) {
                return;
            },
            strokeCircle: function (color, x, y, radius, sAngle, eAngle, lineWidth) {
                return;
            },
            drawLine: function (color, ax, ay, bx, by, width) {
                return;
            },
            drawImage: function (packedImage, sx, sy, sw, sh, x, y, w, h) {
                return;
            },
            begin: function () {
                if (pixelSize !== 1 || Utils.isCocoonJs()) {
                    this.save();
                    this.scale(pixelSize * cocoonScale, pixelSize * cocoonScale);
                }
            },
            flush: function () {
                renderer.render(stage);
                while (stage.children.length) {
                    // clean up
                    stage.removeChild(stage.children[0]);
                }

                if (pixelSize !== 1 || Utils.isCocoonJs()) {
                    this.restore();
                }
            },
            getOpacity: function () {
                return alpha;
            },
            setOpacity: function (value) {
                alpha = value;
            },
            render: function (displayObject) {
                this.drawPixi(displayObject);
            },
            /*
             * Pixi only feature: draws any pixi displayObject
             */
            drawPixi: function (displayObject) {
                // set piximatrix to current transform matrix
                pixiMatrix.a = matrix.a;
                pixiMatrix.b = matrix.b;
                pixiMatrix.c = matrix.c;
                pixiMatrix.d = matrix.d;
                pixiMatrix.tx = matrix.tx;
                pixiMatrix.ty = matrix.ty;

                stage.addChild(displayObject);
                displayObject.transform.setFromMatrix(pixiMatrix);
                displayObject.alpha = alpha;
            },
            getContext: function () {
                return gl;
            },
            getPixiRenderer: function () {
                return renderer;
            },
            // pixi specific: update the webgl view, needed if the canvas changed size
            updateSize: function () {
                renderer.resize(canvas.width, canvas.height);
            }
        };

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
            renderer = new PIXI.Renderer({
                view: canvas,
                width: canvas.width,
                height: canvas.height,
                backgroundColor: 0x000000,
                clearBeforeRender: false,
                antialias: Bento.getAntiAlias()
            });
            return pixiRenderer;
        } else {
            if (!window.PIXI) {
                console.log('WARNING: PIXI library is missing, reverting to Canvas2D renderer');
            } else if (!canWebGl) {
                console.log('WARNING: WebGL not available, reverting to Canvas2D renderer');
            }
            return Canvas2d(canvas, settings);
        }
    };
    return PixiRenderer;
});