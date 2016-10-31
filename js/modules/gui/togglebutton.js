/**
 * An entity that behaves like a toggle button.
 * <br>Exports: Constructor
 * @param {Object} settings - Required, can include Entity settings
 * @param {Sprite} settings.sprite - Same as clickbutton! See @link module:bento/gui/clickbutton}
 * @param {Bool} settings.active - Whether the button starts in the active state (default: true)
 * @param {Bool} settings.toggled - Initial toggle state (default: false)
 * @param {String} settings.onToggle - Callback when user clicks on the toggle ("this" refers to the clickbutton entity).
 * @param {String} [settings.sfx] - Plays sound when pressed
 * @module bento/gui/togglebutton
 * @returns Entity
 */
bento.define('bento/gui/togglebutton', [
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
            toggled = false,
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
            entitySettings = Utils.extend({
                z: 0,
                name: '',
                originRelative: new Vector2(0.5, 0.5),
                position: new Vector2(0, 0),
                components: [
                    sprite,
                    new Clickable({
                        onClick: function () {
                            sprite.setAnimation('down');
                        },
                        onHoldEnter: function () {
                            sprite.setAnimation('down');
                        },
                        onHoldLeave: function () {
                            sprite.setAnimation(toggled ? 'down' : 'up');
                        },
                        pointerUp: function () {
                            sprite.setAnimation(toggled ? 'down' : 'up');
                        },
                        onHoldEnd: function () {
                            if (!active) {
                                return;
                            }
                            if (toggled) {
                                toggled = false;
                            } else {
                                toggled = true;
                            }
                            if (settings.onToggle) {
                                settings.onToggle.apply(entity);
                                if (settings.sfx) {
                                    Bento.audio.stopSound(settings.sfx);
                                    Bento.audio.playSound(settings.sfx);
                                }
                            }
                            sprite.setAnimation(toggled ? 'down' : 'up');
                        }
                    })
                ],
                family: ['buttons']
            }, settings),
            entity = new Entity(entitySettings).extend({
                /**
                 * Check if the button is toggled
                 * @function
                 * @instance
                 * @name isToggled
                 * @returns {Bool} Whether the button is toggled
                 */
                isToggled: function () {
                    return toggled;
                },
                /**
                 * Toggles the button programatically
                 * @function
                 * @param {Bool} state - Toggled or not
                 * @param {Bool} doCallback - Perform the onToggle callback or not
                 * @instance
                 * @name toggle
                 */
                toggle: function (state, doCallback) {
                    if (Utils.isDefined(state)) {
                        toggled = state;
                    } else {
                        toggled = !toggled;
                    }
                    if (doCallback) {
                        if (settings.onToggle) {
                            settings.onToggle.apply(entity);
                            if (settings.sfx) {
                                Bento.audio.stopSound(settings.sfx);
                                Bento.audio.playSound(settings.sfx);
                            }
                        }
                    }
                    sprite.setAnimation(toggled ? 'down' : 'up');
                },
                mimicClick: function () {
                    entity.getComponent('clickable').callbacks.onHoldEnd();
                },
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
                        sprite.setAnimation(toggled ? 'down' : 'up');
                    }
                },
                /**
                 * Performs the callback as if the button was clicked
                 * @function
                 * @instance
                 * @name doCallback
                 */
                doCallback: function () {
                    settings.onToggle.apply(entity);
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
        // set intial state
        if (settings.toggled) {
            toggled = true;
        }

        animations = sprite.animations || animations;
        if (!active && animations.inactive) {
            sprite.setAnimation('inactive');
        } else {
            sprite.setAnimation(toggled ? 'down' : 'up');
        }

        // keep track of togglebuttons on tvOS, Windows, and Poki
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