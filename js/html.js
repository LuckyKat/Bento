/**
 * HTML elements helper module. The Html module is a thin wrapper around HTML elements, adding Bento-like functions
 * to HTML objects. Most notably the `attach` function: which appends HTML elements to other elements. And `removeSelf`: which
 * removes an element from its parent. These functions can be chained as well.
 * To wrap existing HTML elements, one should use the getters or query selectors such as Html.getById() or Html.$ 
 * to retrieve and wrap elements.
 * <br>Exports: Object
 * @module bento/html
 * @moduleName Html
 * @param {String} tag or HTML string - Create a specific element using the tag, for example 'div'. Or write an entire HTML string
 * that will be parsed, for example '<div class="myClass">inner contents</div>'. This will return most the outer element.
 * @param {Object} settings - settings (all properties not listed here will be added as attributes to the element)
 * @param {String} settings.id - Set element ID
 * @param {String} settings.class - Set element Class
 * @param {Array} settings.children - Append children Html elements
 * @param {String} settings.innerHtml - Sets innerHTML
 */
bento.define('bento/html', [
    'bento',
    'bento/utils'
], function (
    Bento,
    Utils
) {
    'use strict';
    var functions = {
        /**
         * Appends child element
         * @function
         * @param {Object} child - The HTML child object to attach
         * @instance
         * @name attach
         * @snippet #Html.attach|Html
            attach(${1:childElement});
         * @returns {Html} Returns itself
         */
        attach: function (child) {
            var i;
            var children;
            var parent = this;
            if (child.length) {
                children = child;
            } else {
                children = arguments;
            }
            // append to array of children to a parent
            for (i = 0; i < children.length; ++i) {
                this.appendChild(children[i]);
            }

            // append returns the parent instead of child!
            return parent;
        },
        /**
         * Sets innerHTML
         * @function
         * @param {String} inner - Sets this as innerHTML
         * @instance
         * @name write
         * @snippet #Html.write|Html
            write('$1');
         * @returns {Html} Returns itself
         */
        write: function (inner) {
            this.innerHTML = inner;
            return this;
        },
        /**
         * Adds to class list
         * @function
         * @param {String} className - Adds this className
         * @instance
         * @name addClass
         * @snippet #Html.addClass|Html
            addClass('$1');
         * @returns {Html} Returns itself
         */
        addClass: function (className) {
            var element = this;
            var classNames = element.className.split(' ');
            if (classNames.indexOf(className) === -1) {
                element.className += ' ' + className;
            }
            return this;
        },
        /**
         * Removes from class list
         * @function
         * @param {String} className - Removes this className
         * @instance
         * @name removeClass
         * @snippet #Html.removeClass|Html
            removeClass('$1');
         * @returns {Html} Returns itself
         */
        removeClass: function (className) {
            var element = this;
            var classNames = element.className.split(' ');
            var index = classNames.indexOf(className);
            if (index >= 0) {
                classNames.splice(index, 1);
                element.className = classNames.join(' ');
            }
            return this;
        },
        /**
         * Removes self from parent node
         * @function
         * @instance
         * @name removeSelf
         * @snippet #Html.removeSelf|Html
            removeSelf();
         * @returns {Html} Returns itself
         */
        removeSelf: function () {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
            return this;
        }
    };
    /**
     * @snippet Html()|from String
    Html('${1:<div></div>}')
     * @snippet Html()|HtmlElement
    Html('${1:div}', {
        id: '$2',
        class: '$3',
        children: [],
        innerHtml: '',
        // you may add any attribute here
    })
     */
    var Html = function (elementName, attr) {
        var settings = attr || {};
        var element;
        var children = settings.children;
        var className = settings.class;
        var id = settings.id;
        var style = '';
        var doc;
        delete settings.children;
        delete settings.class;
        delete settings.id;

        // style can be initialized as string or object literal!
        if (settings.style && Utils.isObject(settings.style)) {
            // expand into string
            Utils.forEach(settings.style, function (value, name) {
                style += name + ': ' + value + '; ';
            });
            settings.style = style;
        }
        if (elementName.trim().indexOf('<') === 0) {
            // parse from string
            doc = new window.DOMParser().parseFromString(elementName, 'text/html');
            element = doc.body.firstChild;
            // append additional functions and attributes
            Html.addFunctions(element);
            Html.addAttributes(element, settings);
            if (className) {
                element.addClass(className);
            }
            if (id) {
                element.id = id;
            }
        } else {
            // create from settings
            element = Html.make(elementName, className, id, settings);
        }

        if (children) {
            Utils.forEach(children, function (child) {
                element.append(child);
            });
        }

        return element;
    };

    Html.addFunctions = function (element) {
        if (element.addClass) {
            return;
        }
        element.attach = functions.attach;
        element.append = functions.attach;
        element.write = functions.write;
        element.addClass = functions.addClass;
        element.removeClass = functions.removeClass;
        element.removeSelf = functions.removeSelf;
        element.$ = element.querySelector;
        element.$$ = element.querySelectorAll;
        Object.defineProperty(element, 'innerHtml', {
            get: function () {
                return this.innerHTML;
            },
            set: function (value) {
                this.innerHTML = value;
            }
        });
    };

    /**
     * Gets element by ID and wraps the Html functionality
     * @function
     * @instance
     * @returns Object
     * @name getById
     * @snippet Html.getById()|Element
    Html.getById('$1')
     */
    Html.getById = function (id) {
        var element = document.getElementById(id);
        if (element) {
            Html.addFunctions(element);
        }
        return element;
    };
    /**
     * Gets element using querySelector and wraps the Html functionality
     * @function
     * @instance
     * @returns Object
     * @name $
     * @snippet Html.$()|Element
    Html.$('$1')
     */
    Html.$ = function (selector) {
        // query selector
        var element = document.querySelector(selector);
        if (element) {
            Html.addFunctions(element);
        }
        return element;
    };
    /**
     * Gets element using querySelectorAll and wraps the Html functionality
     * @function
     * @instance
     * @returns Object
     * @name $$
     * @snippet Html.$$()|Element
    Html.$$('$1')
     */
    Html.$$ = function (selector) {
        // query selector
        var elements = document.querySelectorAll(selector);
        if (elements) {
            Utils.forEach(elements, function (element) {
                Html.addFunctions(element);
            });
        }
        return elements;
    };
    Html.appendToBody = function (element) {
        document.body.appendChild(element);
        return element;
    };
    Html.makeDiv = function (className, id, attributes) {
        return this.make('div', className, id, attributes);
    };
    Html.make = function (type, className, id, attributes) {
        var element = document.createElement(type);
        if (id) {
            element.id = id;
        }
        if (className) {
            element.className = className;
        }
        if (attributes) {
            Html.addAttributes(element, attributes);
        }
        Html.addFunctions(element);
        return element;
    };
    Html.addAttributes = function (element, attributes) {
        var attribute;
        for (attribute in attributes) {
            if (!attributes.hasOwnProperty(attribute)) {
                continue;
            }
            if (attribute.indexOf('on') === 0) {
                element[attribute] = attributes[attribute];
            } else if (attribute === 'innerHtml' || attribute === 'innerHTML') {
                element.innerHTML = attributes[attribute];
            } else {
                element.setAttribute(attribute, attributes[attribute]);
            }
        }
    };
    Html.remove = function (element) {
        if (element.parentNode) {
            element.parentNode.removeChild(element);
        }
    };
    /**
     * @snippet Html.removeById()|snippet
    Html.removeById($1)
     */
    Html.removeById = function (id) {
        var element = Html.getById(id);
        if (element) {
            Html.remove(element);
        }
        return element;
    };

    return Html;
});