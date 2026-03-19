import fs from "fs"
import path from "path"

const GROUPS_FOLDER = path.join(process.cwd(), "../groups")

export function saveGroups(groups) {
    if (!fs.existsSync(path.join(GROUPS_FOLDER, 'groups.json'))) {
        fs.writeFileSync(path.join(GROUPS_FOLDER, 'groups.json'), JSON.stringify({
            ...groups
        }, null, 2))
        return groups
    }

    const savedGroups = JSON.parse(fs.readFileSync(path.join(GROUPS_FOLDER, 'groups.json')))
    fs.writeFileSync(path.join(GROUPS_FOLDER, 'groups.json'), JSON.stringify({ 
        ...savedGroups, 
        ...groups
    }, null, 2))
    return JSON.parse(fs.readFileSync(path.join(GROUPS_FOLDER, 'groups.json')))
}

export function getGroups() {
    if (!fs.existsSync(GROUPS_FOLDER)) fs.mkdirSync(GROUPS_FOLDER, { recursive: true })
    if (!fs.existsSync(path.join(GROUPS_FOLDER, 'groups.json'))) return null
    try {
        return JSON.parse(fs.readFileSync(path.join(GROUPS_FOLDER, 'groups.json')))
    } catch (error) {
        return null
    }
}
