// ===== JSON mappings =====

// Bold Fraktur
const boldFraktur = {
    "A": "𝐀", "B": "𝐁", "C": "𝐂", "D": "𝐃", "E": "𝐄", "F": "𝐅", "G": "𝐆",
    "H": "𝐇", "I": "𝐈", "J": "𝐉", "K": "𝐊", "L": "𝐋", "M": "𝐌", "N": "𝐍",
    "O": "𝐎", "P": "𝐏", "Q": "𝐐", "R": "𝐑", "S": "𝐒", "T": "𝐓", "U": "𝐔",
    "V": "𝐕", "W": "𝐖", "X": "𝐗", "Y": "𝐘", "Z": "𝐙",

    "a": "𝐚", "b": "𝐛", "c": "𝐜", "d": "𝐝", "e": "𝐞", "f": "𝐟", "g": "𝐠",
    "h": "𝐡", "i": "𝐢", "j": "𝐣", "k": "𝐤", "l": "𝐥", "m": "𝐦", "n": "𝐧",
    "o": "𝐨", "p": "𝐩", "q": "𝐪", "r": "𝐫", "s": "𝐬", "t": "𝐭", "u": "𝐮",
    "v": "𝐯", "w": "𝐰", "x": "𝐱", "y": "𝐲", "z": "𝐳",

    "0": "𝟎", "1": "𝟏", "2": "𝟐", "3": "𝟑", "4": "𝟒",
    "5": "𝟓", "6": "𝟔", "7": "𝟕", "8": "𝟖", "9": "𝟗"
};

// Normal Fraktur
const normalFraktur = {
    "A": "𝐴", "B": "𝐵", "C": "𝐶", "D": "𝐷", "E": "𝐸", "F": "𝐹", "G": "𝐺",
    "H": "𝐻", "I": "𝐼", "J": "𝐽", "K": "𝐾", "L": "𝐿", "M": "𝑀", "N": "𝑁",
    "O": "𝑂", "P": "𝑃", "Q": "𝑄", "R": "𝑅", "S": "𝑆", "T": "𝑇", "U": "𝑈",
    "V": "𝑉", "W": "𝑊", "X": "𝑋", "Y": "𝑌", "Z": "𝑍",

    "a": "𝑎", "b": "𝑏", "c": "𝑐", "d": "𝑑", "e": "𝑒", "f": "𝑓", "g": "𝑔",
    "h": "ℎ", "i": "𝑖", "j": "𝑗", "k": "𝑘", "l": "𝑙", "m": "𝑚", "n": "𝑛",
    "o": "𝑜", "p": "𝑝", "q": "𝑞", "r": "𝑟", "s": "𝑠", "t": "𝑡", "u": "𝑢",
    "v": "𝑣", "w": "𝑤", "x": "𝑥", "y": "𝑦", "z": "𝑧"
};

// Mathematical Bold Script
const boldScript = {
    "A": "𝑨", "B": "𝑩", "C": "𝑪", "D": "𝑫", "E": "𝑬", "F": "𝑭", "G": "𝑮",
    "H": "𝑯", "I": "𝑰", "J": "𝑱", "K": "𝑲", "L": "𝑳", "M": "𝑴", "N": "𝑵",
    "O": "𝑶", "P": "𝑷", "Q": "𝑸", "R": "𝑹", "S": "𝑺", "T": "𝑻", "U": "𝑼",
    "V": "𝑽", "W": "𝑾", "X": "𝑿", "Y": "𝒀", "Z": "𝒁",

    "a": "𝒂", "b": "𝒃", "c": "𝒄", "d": "𝒅", "e": "𝒆", "f": "𝒇", "g": "𝒈",
    "h": "𝒉", "i": "𝒊", "j": "𝒋", "k": "𝒌", "l": "𝒍", "m": "𝒎", "n": "𝒏",
    "o": "𝒐", "p": "𝒑", "q": "𝒒", "r": "𝒓", "s": "𝒔", "t": "𝒕", "u": "𝒖",
    "v": "𝒗", "w": "𝒘", "x": "𝒙", "y": "𝒚", "z": "𝒛"
}

// ===== Conversion function =====

function fancyTransform(text) {
    const words = text.split(/(\s+)/); // keep spaces
    const longText = text.length > 100;

    return text;
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

export { fancyTransform }

