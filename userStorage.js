import fs from "fs"
import path from "path"

const USER_FOLDER = path.join(process.cwd(), "../users")
export const POINTS_LIST = {
    joinGame: 1,
    WinAsVillager: 2,
    WinAsWolve: 3,
    WinAsLover: 4,
    StartSuccessfulGame: 2,
    deathPenatly: -1,
    changeVotePenalty: -3,
    hunterKillsWolf: 2,
    witchPoisonWolf: 2,
    votedWolf: 1,
    votedInnocent: -2
}

export function saveUser(user) {
    if (!fs.existsSync(path.join(USER_FOLDER, user.jid + '.json'))) {
        fs.writeFileSync(path.join(USER_FOLDER, user.jid + '.json'), JSON.stringify(user, null, 2))
        return user
    }

    const SavedUser = JSON.parse(fs.readFileSync(path.join(USER_FOLDER, user.jid + '.json')))
    fs.writeFileSync(path.join(USER_FOLDER, user.jid + '.json'), JSON.stringify({ ...SavedUser, ...user }, null, 2))
    return JSON.parse(fs.readFileSync(path.join(USER_FOLDER, user.jid + '.json')))
}

export function getUser(jid) {
    if (!fs.existsSync(USER_FOLDER)) fs.mkdirSync(USER_FOLDER, { recursive: true })

    if (!fs.existsSync(path.join(USER_FOLDER, jid + '.json'))) return null
    try {
        return JSON.parse(fs.readFileSync(path.join(USER_FOLDER, jid + '.json')))
    } catch (error) {
        return null
    }
}