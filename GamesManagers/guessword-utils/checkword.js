import axios from "axios";
import * as cheerio from "cheerio";

export async function parseWiktionary(word, lang = ["Français", "Anglais"]) {
    const url = `https://fr.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}`;
    console.log(`Fetching: ${url}`);

    try {
        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'DNT': '1', // Do Not Track
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 10000 // 10 seconds timeout
        });

        const $ = cheerio.load(html);
        const title = $("#firstHeading").text().trim();

        const sections = [];
        $("h2").each((_, el) => {
            const sectionTitle = $(el).text().trim();
            const sectionId = $(el).attr("id") || "";
            if (sectionTitle !== "Sommaire")
                sections.push({ sectionTitle, sectionId });
        });

        return {
            title,
            url,
            sections,
            found: sections.some(s => lang.includes(s.sectionTitle)),
        };
    } catch (err) {
        console.log("Error fetching or parsing page:", err.message);
        return null;
    }
}

// Example usage
(async () => {
    const word = process.argv[2] || "food";
    const wiktionary = await parseWiktionary(word);
    if (!wiktionary){
        console.log("Word not found or error occurred.");
        return;
    }

    console.log("Title:", wiktionary.title);
     console.log("Corresponds:", wiktionary.found);
     console.log("Sections found:", wiktionary.sections.map(s => s.sectionTitle));
})();
