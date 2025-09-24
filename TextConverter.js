// ===== JSON mappings =====

// Bold Fraktur
const boldFraktur = {
    "A": "𝕬", "B": "𝕭", "C": "𝕮", "D": "𝕯", "E": "𝕰", "F": "𝕱", "G": "𝕲",
    "H": "𝕳", "I": "𝕴", "J": "𝕵", "K": "𝕶", "L": "𝕷", "M": "𝕸", "N": "𝕹",
    "O": "𝕺", "P": "𝕻", "Q": "𝕼", "R": "𝕽", "S": "𝕾", "T": "𝕿", "U": "𝖀",
    "V": "𝖁", "W": "𝖂", "X": "𝖃", "Y": "𝖄", "Z": "𝖅",
    "a": "𝖆", "b": "𝖇", "c": "𝖈", "d": "𝖉", "e": "𝖊", "f": "𝖋", "g": "𝖌",
    "h": "𝖍", "i": "𝖎", "j": "𝖏", "k": "𝖐", "l": "𝖑", "m": "𝖒", "n": "𝖓",
    "o": "𝖔", "p": "𝖕", "q": "𝖖", "r": "𝖗", "s": "𝖘", "t": "𝖙", "u": "𝖚",
    "v": "𝖛", "w": "𝖜", "x": "𝖝", "y": "𝖞", "z": "𝖟"
};

// Normal Fraktur
const normalFraktur = {
    "A": "𝔄", "B": "𝔅", "C": "ℭ", "D": "𝔇", "E": "𝔈", "F": "𝔉", "G": "𝔊",
    "H": "ℌ", "I": "ℑ", "J": "𝔍", "K": "𝔎", "L": "𝔏", "M": "𝔐", "N": "𝔑",
    "O": "𝔒", "P": "𝔓", "Q": "𝔔", "R": "ℜ", "S": "𝔖", "T": "𝔗", "U": "𝔘",
    "V": "𝔙", "W": "𝔚", "X": "𝔛", "Y": "𝔜", "Z": "ℨ",
    "a": "𝔞", "b": "𝔟", "c": "𝔠", "d": "𝔡", "e": "𝔢", "f": "𝔣", "g": "𝔤",
    "h": "𝔥", "i": "𝔦", "j": "𝔧", "k": "𝔨", "l": "𝔩", "m": "𝔪", "n": "𝔫",
    "o": "𝔬", "p": "𝔭", "q": "𝔮", "r": "𝔯", "s": "𝔰", "t": "𝔱", "u": "𝔲",
    "v": "𝔳", "w": "𝔴", "x": "𝔵", "y": "𝔶", "z": "𝔷"
};

// Mathematical Bold Script
const boldScript = {
    "A": "𝓐", "B": "𝓑", "C": "𝓒", "D": "𝓓", "E": "𝓔", "F": "𝓕", "G": "𝓖",
    "H": "𝓗", "I": "𝓘", "J": "𝓙", "K": "𝓚", "L": "𝓛", "M": "𝓜", "N": "𝓝",
    "O": "𝓞", "P": "𝓟", "Q": "𝓠", "R": "𝓡", "S": "𝓢", "T": "𝓣", "U": "𝓤",
    "V": "𝓥", "W": "𝓦", "X": "𝓧", "Y": "𝓨", "Z": "𝓩"
};

// ===== Conversion function =====

function fancyTransform(text) {
    const words = text.split(/(\s+)/); // keep spaces
    const longText = text.length > 100;

    return words.map(word => {
        const allCaps = /^[A-Z]+$/.test(word); // check if word is ALL CAPS

        return word.split("").map(ch => {
            if (!/[A-Za-z]/.test(ch)) {
                return ch; // leave numbers & symbols
            }

            const isUpper = ch === ch.toUpperCase();

            if (allCaps && isUpper) {
                // Rule 5: caps in ALL CAPS word -> Bold Script
                return boldScript[ch] || ch;
            }

            if (longText) {
                // Text > 100 chars
                return normalFraktur[ch] || ch;
            } else {
                // Text < 100 chars
                return boldFraktur[ch] || ch;
            }

        }).join("");
    }).join("");
}

export {fancyTransform}

