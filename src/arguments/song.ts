import { Argument, Possible } from 'klasa';
import { Track } from 'lavalink';
import { URL } from 'url';
import { AeliaMessage } from '../lib/types/Misc';

export default class extends Argument {

	public async run(arg: string, _: Possible, message: AeliaMessage): Promise<any> {
		if (!message.guild) return null;

		arg = arg.replace(/<(.+)>/g, '$1');
		const parsedURL = this.parseURL(arg);
		if (parsedURL) {
			const tracks = await message.guild.music.fetch(arg);
			return parsedURL.playlist ? tracks : tracks[0];
		} else if (('sc' in message.flags) || ('soundcloud' in message.flags)) {
			const tracks = await message.guild.music.fetch(`scsearch: ${arg}`);
			return tracks[0];
		}
		const tracks = await message.guild.music.fetch(`ytsearch: ${arg}`).catch(() => [] as Track[]);
		if (!tracks.length) tracks.push(...await message.guild.music.fetch(`scsearch: ${arg}`).catch(() => [] as Track[]));
		if (!tracks.length) throw message.language.get('MUSICMANAGER_FETCH_NO_MATCHES');
		return tracks[0];


	}

	public parseURL(url: string): { url: string; playlist: boolean } | null {
		try {
			const parsed = new URL(url);
			return parsed.protocol && parsed.hostname && (parsed.protocol === 'https:' || parsed.protocol === 'http:')
				? { url: parsed.href, playlist: parsed.searchParams.has('list') }
				: null;
		} catch (error) {
			return null;
		}
	}

}
