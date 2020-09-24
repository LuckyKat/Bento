/**
 * The HtmlContainer represents an HTML element floating above Bento's canvas element.
 * The HTML element will appear when this entity is attached.
* <br>Exports: Constructor
 * @module {Entity} bento/gui/htmlcontainer
 * @returns {Entity} Returns an entity object
 * @moduleName HtmlContainer
 * @snippet HtmlContainer|Constructor
HtmlContainer({
    position: new Vector2(${1:0}, ${2:0}),
    width: ${3:16},
    height: ${4:16},
    originRelative: new Vector2(0.5, 0.5),
    style: {}, // style properties same as CSS
    htmlChildren: [] // attach HTML elements
})
 */
bento.define('bento/gui/htmlcontainer', [
    'bento',
    'bento/utils',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/html',
    'bento/entity'
], function (
    Bento,
    Utils,
    Vector2,
    Rectangle,
    Html,
    Entity
) {
    'use strict';
    var HtmlContainer = function (settings) {
        var position = settings.position || new Vector2(0, 0);
        var width = settings.width || 0;
        var height = settings.height || 0;
        var origin = settings.origin || new Vector2(0, 0);
        if (settings.originRelative) {
            origin.x = width * settings.originRelative.x;
            origin.y = height * settings.originRelative.y;
        }
        var viewport = Bento.getViewport();
        var canvas = Bento.getCanvas();
        // get the css size
        var domRect = canvas.getBoundingClientRect();
        var element = new Html('div', {
            style: Utils.extend({
                position: 'absolute',
                top: (position.y - origin.y) / viewport.height * domRect.height,
                left: (position.x - origin.x) / viewport.width * domRect.width,
                width: width / viewport.width * domRect.width,
                height: height / viewport.height * domRect.height
            }, settings.style || {}),
            children: settings.htmlChildren
        });
        var component = new Object({
            name: 'component',
            start: function (data) {
                Html.appendToBody(element);
            },
            destroy: function (data) {
                element.removeSelf();
            }
        });
        var entity = new Entity({
            z: settings.z,
            name: 'htmlContainer',
            components: [
                component
            ]
        }).extend({
            /**
             * The Html element
             * @instance
             * @name html
             * @snippet #Entity.html|String
                html
             */
            html: element
        });

        return entity;
    };
    return HtmlContainer;
});