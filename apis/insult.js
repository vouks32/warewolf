export const BadlyRespondToUser = async (user, whatsapp, priv = false) => {
    if(!user) return
    const insult = await fetch('https://evilinsult.com/generate_insult.php?lang=fr&type=json')
}