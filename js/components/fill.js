/**
 * Component that fills a square.
 * <br>Exports: Constructor
 * @module bento/components/fill
 * @moduleName Fill
 * @param {Object} settings - Settings
 * @param {Array} settings.color - Color ([1, 1, 1, 1] is pure white). Alternatively use the Color module.
 * @param {Rectangle} settings.dimension - Size to fill up (defaults to viewport size)
 * @param {Rectangle} settings.origin - Origin point
 * @param {Rectangle} settings.originRelative - Set origin with relative to the dimension
 * @returns Returns a component object to be attached to an entity.
 * @snippet Fill|constructor
Fill({
    name: 'fill',
    dimension: viewport.getSize(),
    color: [${1:0}, ${2:0}, ${3:0}, 1], // [1, 1, 1, 1] is pure white
    originRelative: new Vector2(${4:0}, ${5:0})
})
 */
bento.define('bento/components/fill', [
    'bento/utils',
    'bento',
    'bento/math/vector2'
], function (
    Utils,
    Bento,
    Vector2
) {
    'use strict';
    var Fill = function (settings) {
        if (!(this instanceof Fill)) {
            return new Fill(settings);
        }
        var viewport = Bento.getViewport();
        settings = settings || {};
        this.parent = null;
        this.rootIndex = -1;
        this.name = settings.name || 'fill';
        /**
         * Color array
         * @instance
         * @name color
         * @snippet #Fill.color|Array
            color
         */
        this.color = settings.color || [0, 0, 0, 1];
        while (this.color.length < 4) {
            this.color.push(1);
        }
        /**
         * Dimension/size of the rectangle to fill
         * @instance
         * @name dimension
         * @snippet #Fill.dimension|Rectangle
            dimension
         */
        this.dimension = settings.dimension || settings.size || settings.rectangle || viewport.getSize();
        /**
         * Origin of the fill size
         * @instance
         * @name origin
         * @snippet #Fill.origin|Vector2
            origin
         */
        this.origin = settings.origin || new Vector2(0, 0);
        if (settings.originRelative) {
            this.origin.x = this.dimension.width * settings.originRelative.x;
            this.origin.y = this.dimension.height * settings.originRelative.y;
        }

        this.graphics = new PIXI.Graphics();

        // start a fill
        this.startFill();
        // TODO: if this.dimension is edited, the fill should be redone
    };
    Fill.prototype.startFill = function () {
        var color = this.color;
        var dimension = this.dimension;
        var origin = this.origin;
        var colorInt = color[2] * 255 + (color[1] * 255 << 8) + (color[0] * 255 << 16);
        this.graphics.clear();
        this.graphics.beginFill(colorInt);
        this.graphics.drawRect(
            dimension.x - origin.x,
            dimension.y - origin.y,
            dimension.width,
            dimension.height
        );
        this.graphics.endFill();

    };
    Fill.prototype.draw = function (data) {
        // TODO: use pixi graphics
        // var dimension = this.dimension;
        // var origin = this.origin;
        // data.renderer.fillRect(
        //     this.color,
        //     dimension.x - origin.x,
        //     dimension.y - origin.y,
        //     dimension.width,
        //     dimension.height
        // );
        data.renderer.render(this.graphics);
    };
    /**
     * Set origin relative to size
     * @instance
     * @function
     * @name setOriginRelative
     * @param {Vector2} originRelative - Vector2 with the origin relative to its dimension
     * @snippet #Fill.setOriginRelative()|snippet
        setOriginRelative(${1:new Vector2(0, 0)})
     */
    Fill.prototype.setOriginRelative = function (originRelative) {
        this.origin.x = this.dimension.width * originRelative.x;
        this.origin.y = this.dimension.height * originRelative.y;
    };
    Fill.prototype.toString = function () {
        return '[object Fill]';
    };

    return Fill;
});