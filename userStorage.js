import fs from "fs"
import path from "path"

const USER_FOLDER = path.join(process.cwd(), "users")

export function saveUser(user) {
    if (!fs.existsSync(path.join(USER_FOLDER, user.id + '.json'))) {
        fs.writeFileSync(path.join(USER_FOLDER, user.id + '.json'), JSON.stringify(user, null, 2))
        return
    }

    const SavedUser = JSON.parse(fs.readFileSync(path.join(USER_FOLDER, user.id + '.json')))
    fs.writeFileSync(path.join(USER_FOLDER, user.id + '.json'), JSON.stringify({ ...SavedUser, ...user }, null, 2))
}

export function getUser(id) {
    if (!fs.existsSync(path.join(USER_FOLDER, id + '.json'))) return {}
    try {
        return JSON.parse(fs.readFileSync(path.join(USER_FOLDER, id + '.json')))
    } catch (error) {
        return {}
    }
}