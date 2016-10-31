/**
 * An entity that behaves like a click button.
 * <br>Exports: Constructor
 * @param {Object} settings - Required, can include Entity settings
 * @param {Sprite} settings.sprite - Sprite component. The sprite should have an "up", "down" and an "inactive" animation. Alternatively, you can pass all Sprite settings. Then, by default "up" and "down" are assumed to be frames 0 and 1 respectively. Frame 3 is assumed to be "inactive", if it exists
 * @param {Function} settings.onClick - Callback when user clicks on the button ("this" refers to the clickbutton entity). Alternatively, you can listen to a "clickButton" event, the entity is passed as parameter.
 * @param {Bool} settings.active - Whether the button starts in the active state (default: true)
 * @param {String} [settings.sfx] - Plays sound when pressed
 * @param {Function} [settings.onButtonDown] - When the user holds the mouse or touches the button
 * @param {Function} [settings.onButtonUp] - When the user releases the mouse or stops touching the button
 * @module bento/gui/clickbutton
 * @returns Entity
 */
bento.define('bento/gui/clickbutton', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/utils',
    'bento/tween',
    'bento/eventsystem'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    Utils,
    Tween,
    EventSystem
) {
    'use strict';
    return function (settings) {
        var viewport = Bento.getViewport(),
            active = true,
            animations = settings.animations || {
                'up': {
                    speed: 0,
                    frames: [0]
                },
                'down': {
                    speed: 0,
                    frames: [1]
                }
            },
            sprite = settings.sprite || new Sprite({
                image: settings.image,
                imageName: settings.imageName,
                frameWidth: settings.frameWidth,
                frameHeight: settings.frameHeight,
                frameCountX: settings.frameCountX,
                frameCountY: settings.frameCountY,
                animations: animations
            }),
            clickable = new Clickable({
                onClick: function () {
                    if (!active) {
                        return;
                    }
                    sprite.setAnimation('down');
                    if (settings.onButtonDown) {
                        settings.onButtonDown.apply(entity);
                    }
                },
                onHoldEnter: function () {
                    if (!active) {
                        return;
                    }
                    sprite.setAnimation('down');
                    if (settings.onButtonDown) {
                        settings.onButtonDown.apply(entity);
                    }
                },
                onHoldLeave: function () {
                    if (!active) {
                        return;
                    }
                    sprite.setAnimation('up');
                    if (settings.onButtonUp) {
                        settings.onButtonUp.apply(entity);
                    }
                },
                pointerUp: function () {
                    if (!active) {
                        return;
                    }
                    sprite.setAnimation('up');
                    if (settings.onButtonUp) {
                        settings.onButtonUp.apply(entity);
                    }
                },
                onHoldEnd: function () {
                    if (active && settings.onClick) {
                        settings.onClick.apply(entity);
                        if (settings.sfx) {
                            Bento.audio.stopSound(settings.sfx);
                            Bento.audio.playSound(settings.sfx);
                        }
                        EventSystem.fire('clickButton', entity);
                    }
                }
            }),
            entitySettings = Utils.extend({
                z: 0,
                name: 'clickButton',
                originRelative: new Vector2(0.5, 0.5),
                position: new Vector2(0, 0),
                components: [
                    sprite,
                    clickable
                ],
                family: ['buttons'],
                init: function () {
                    animations = sprite.animations || animations;
                    if (!active && animations.inactive) {
                        sprite.setAnimation('inactive');
                    } else {
                        sprite.setAnimation('up');
                    }
                }
            }, settings),
            entity = new Entity(entitySettings).extend({
                /**
                 * Activates or deactives the button. Deactivated buttons cannot be pressed.
                 * @function
                 * @param {Bool} active - Should be active or not
                 * @instance
                 * @name setActive
                 */
                setActive: function (bool) {
                    active = bool;
                    if (!active && animations.inactive) {
                        sprite.setAnimation('inactive');
                    } else {
                        sprite.setAnimation('up');
                    }
                },
                /**
                 * Performs the callback as if the button was clicked
                 * @function
                 * @instance
                 * @name doCallback
                 */
                doCallback: function () {
                    settings.onClick.apply(entity);
                },
                /**
                 * Check if the button is active
                 * @function
                 * @instance
                 * @name isActive
                 * @returns {Bool} Whether the button is active
                 */
                isActive: function () {
                    return active;
                }
            });

        if (Utils.isDefined(settings.active)) {
            active = settings.active;
        }

        // keep track of clickbuttons on tvOS, Windows, and Poki
        if (window.ejecta || window.Windows || window.poki) {
            entity.attach({
                start: function () {
                    EventSystem.fire('clickbuttonAdded', entity);
                },
                destroy: function () {
                    EventSystem.fire('clickbuttonRemoved', entity);
                }
            });
        }

        return entity;
    };
});