/**
 * Anchor component. This component is particularly useful for placing UI elements on screen, especially
 * with games having both portrait and landscape mode. Uses 2 position inputs: 1 relative in 
 * screen space <(0,0) to (1,1)>, and one absolute (called offset). 
 * Whenever the viewport changes it dimensions, it recalculates the desired position for its parent
 *
 * @example
// If something should have a (-40, 20) offset from the middle-right of the screen, pass:
{
    relative : new Vector2(1, 0.5),
    offset : new Vector2(-40, 20)
}
 * For custom needs, it's also possible to use the onResize callback (which is called after setting the positions)
 *
 * Note that this component directly sets the position of the parent entity.
 * 
 * @snippet Anchor|Single-Orientation
Anchor({
    relative: new Vector2(${1:0.5}, ${2:0.5}),
    offset: new Vector2(${3:0}, ${4:0}),
    onResize: function (isPortrait) {}
})
 * @snippet Anchor|Multi-Orientation
Anchor({
    portrait: {
        relative: new Vector2(${1:0.5}, ${2:0.5}),
        offset: new Vector2(${3:0}, ${4:0}),
    },
    landscape: {
        relative: new Vector2(${5:0.5}, ${6:0.5}),
        offset: new Vector2(${7:0}, ${8:0}),
    },
    onResize: function (isPortrait) {}
})
 * <br>Exports: Constructor
 * @module bento/components/anchor
 * @moduleName Anchor
 * @param {Object} settings - Settings
 * @param {Vector2} settings.relative - Vector2 position relative to topleft corner
 * @param {Vector2} settings.offset - Absolute Vector2 position
 * @param {Function} settings.onResize - Callback after game resizes or rotates
 */
bento.define('bento/components/anchor', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Entity,
    EventSystem,
    Utils,
    Tween
) {
    'use strict';
    var Anchor = function (settings) {
        var onResize = settings.onResize;
        var offset = settings.offset || new Vector2(0, 0);
        var relative = settings.relative || new Vector2(0, 0);
        var landscape = {
            offset: settings.landscape ? (settings.landscape.offset || offset) : offset,
            relative: settings.landscape ? (settings.landscape.relative || relative) : relative
        };
        var portrait = {
            offset: settings.portrait ? (settings.portrait.offset || offset) : offset,
            relative: settings.portrait ? (settings.portrait.relative || relative) : relative
        };
        var resetPosition = function () {
            var safeZone = Anchor.getSafeZone();
            var orientation = Anchor.isPortrait() ? portrait : landscape;
            entity.position.x = safeZone.x + orientation.relative.x * safeZone.width + orientation.offset.x;
            entity.position.y = safeZone.y + orientation.relative.y * safeZone.height + orientation.offset.y;

            if (onResize) {
                onResize.call(component, Anchor.isPortrait());
            }
        };
        var entity;
        var component = {
            name: 'anchor',
            start: function (data) {
                EventSystem.on('resize', resetPosition);
                resetPosition();
            },
            destroy: function (data) {
                EventSystem.off('resize', resetPosition);
            },
            attached: function (data) {
                entity = data.entity;
            },
            resetPosition: resetPosition
        };
        return component;
    };
    /**
     * Returns true if orientation is portrait
     * @snippet Anchor.isPortrait()|Boolean
     * @instance
     * @function
     * @name isPortrait
     */
    Anchor.isPortrait = function () {
        var viewport = Bento.getViewport();
        return viewport.width < viewport.height;
    };
    /**
     * Safe zone is the area inside the viewport that is considered
     * safe from any notches, rounded corners and others.
     * @snippet Anchor.getSafeZone()|Rectangle
     * @instance
     * @function
     * @param {Boolean} withViewportOffset - Should offset with viewport x and y?
     * @name getSafeZone
     */
    Anchor.getSafeZone = function (withViewportOffset) {
        // retrieve safezone
        var viewport = Bento.getViewport();
        var height = viewport.height;
        var width = viewport.width;

        var insets = Anchor.getInsets();
        var safeZone, safeHeight, safeWidth;

        // turn insets into Rectangle
        safeHeight = height - insets.top - insets.bottom;
        safeWidth = width - insets.left - insets.right;
        safeZone = new Rectangle(insets.left, insets.top, safeWidth, safeHeight);

        if (withViewportOffset) {
            safeZone.x += viewport.x;
            safeZone.y += viewport.y;
        }
        return safeZone;
    };
    /**
     * Get screen safe area insets (due to notches and rounded corners etc)
     * @function
     * @instance
     * @name getInsets
     * @returns {Object} Object with top, left, right and bottom insets
     */
    Anchor.getInsets = function () {
        var screenSize = Utils.getScreenSize();
        var viewport = Bento.getViewport();
        var overrides = Anchor.insetOverrides;
        var insets = {
            top: 0,
            left: 0,
            right: 0,
            bottom: 0
        };
        // retrieve safezone insets with css
        if (document && document.documentElement && window && window.getComputedStyle) {
            insets.top = window.getComputedStyle(document.documentElement).getPropertyValue("--sat");
            insets.right = window.getComputedStyle(document.documentElement).getPropertyValue("--sar");
            insets.bottom = window.getComputedStyle(document.documentElement).getPropertyValue("--sab");
            insets.left = window.getComputedStyle(document.documentElement).getPropertyValue("--sal");

            insets.top = parseInt(insets.top) / (screenSize.height * window.devicePixelRatio) * viewport.height;
            insets.bottom = parseInt(insets.bottom) / (screenSize.height * window.devicePixelRatio) * viewport.height;
            insets.left = parseInt(insets.left) / (screenSize.width * window.devicePixelRatio) * viewport.width;
            insets.right = parseInt(insets.right) / (screenSize.width * window.devicePixelRatio) * viewport.width;
        }

        // use overrides if available
        if (overrides.top !== null) {
            insets.top = overrides.top;
        }
        if (overrides.bottom !== null) {
            insets.bottom = overrides.bottom;
        }
        if (overrides.left !== null) {
            insets.left = overrides.left;
        }
        if (overrides.right !== null) {
            insets.right = overrides.right;
        }

        return insets;
    };
    /**
     * For testing purposes, it's possible to override the insets
     * @instance
     * @name insetOverrides
     */
    Anchor.insetOverrides = {
        top: null,
        left: null,
        right: null,
        bottom: null
    };

    // apply env properties
    if (document && document.documentElement && window && window.getComputedStyle) {
        document.documentElement.style.setProperty('--sat', 'env(safe-area-inset-top)');
        document.documentElement.style.setProperty('--sar', 'env(safe-area-inset-right)');
        document.documentElement.style.setProperty('--sab', 'env(safe-area-inset-bottom)');
        document.documentElement.style.setProperty('--sal', 'env(safe-area-inset-left)');
    }
    return Anchor;
});