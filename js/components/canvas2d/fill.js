/**
 * Component that fills a rectangle with a color.
 * <br>Exports: Constructor
 * @module bento/components/canvas2d/fill
 * @moduleName Canvas2DFill
 */
bento.define('bento/components/canvas2d/fill', [
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
    };
    Fill.prototype.draw = function (data) {
        var dimension = this.dimension;
        var origin = this.origin;
        data.renderer.fillRect(
            this.color,
            dimension.x - origin.x,
            dimension.y - origin.y,
            dimension.width,
            dimension.height
        );
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