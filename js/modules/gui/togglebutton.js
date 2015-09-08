bento.define('bento/gui/togglebutton', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    Utils,
    Tween
) {
    'use strict';
    return function (settings) {
        var viewport = Bento.getViewport(),
            active = true,
            toggled = false,
            entitySettings = Utils.extend({
                z: 0,
                name: '',
                originRelative: new Vector2(0.5, 0.5),
                position: new Vector2(0, 0),
                components: [Sprite, Clickable],
                family: ['buttons'],
                sprite: {
                    image: settings.image,
                    frameWidth: settings.frameWidth || 32,
                    frameHeight: settings.frameHeight || 32,
                    animations: settings.animations || {
                        'up': {
                            speed: 0,
                            frames: [0]
                        },
                        'down': {
                            speed: 0,
                            frames: [1]
                        }
                    }
                },
                clickable: {
                    onClick: function () {
                        entity.sprite.setAnimation('down');
                    },
                    onHoldEnter: function () {
                        entity.sprite.setAnimation('down');
                    },
                    onHoldLeave: function () {
                        entity.sprite.setAnimation(toggled ? 'down' : 'up');
                    },
                    pointerUp: function () {
                        entity.sprite.setAnimation(toggled ? 'down' : 'up');
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
                        entity.sprite.setAnimation(toggled ? 'down' : 'up');
                    }
                },
                init: function () {}
            }, settings),
            entity = new Entity(entitySettings).extend({
                isToggled: function () {
                    return toggled;
                },
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
                    entity.sprite.setAnimation(toggled ? 'down' : 'up');
                }
            });

        if (Utils.isDefined(settings.active)) {
            active = settings.active;
        }
        // set intial state
        if (settings.toggled) {
            toggled = true;
        }
        entity.sprite.setAnimation(toggled ? 'down' : 'up');
        return entity;
    };
});