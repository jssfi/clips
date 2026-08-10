// SPDX-License-Identifier: GPL-2.0-or-later
// This host links with OBS Studio/libobs, which is licensed under GPL-2.0-or-later.

#include <windows.h>
#include <dxgi1_6.h>

#include <obs.h>
#include <obs-audio-controls.h>
#include <util/base.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <filesystem>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace fs = std::filesystem;

template<typename T, void (*Release)(T *)> class ObsRef {
public:
	ObsRef() = default;
	explicit ObsRef(T *value) : value_(value) {}
	~ObsRef() { reset(); }
	ObsRef(const ObsRef &) = delete;
	ObsRef &operator=(const ObsRef &) = delete;
	ObsRef(ObsRef &&other) noexcept : value_(other.value_) { other.value_ = nullptr; }
	ObsRef &operator=(ObsRef &&other) noexcept
	{
		if (this != &other) {
			reset();
			value_ = other.value_;
			other.value_ = nullptr;
		}
		return *this;
	}
	void reset(T *next = nullptr)
	{
		if (value_)
			Release(value_);
		value_ = next;
	}
	T *get() const { return value_; }
	operator T *() const { return value_; }
	explicit operator bool() const { return value_ != nullptr; }

private:
	T *value_ = nullptr;
};

using DataRef = ObsRef<obs_data_t, obs_data_release>;
using DataArrayRef = ObsRef<obs_data_array_t, obs_data_array_release>;
using SourceRef = ObsRef<obs_source_t, obs_source_release>;
using SceneRef = ObsRef<obs_scene_t, obs_scene_release>;
using EncoderRef = ObsRef<obs_encoder_t, obs_encoder_release>;
using OutputRef = ObsRef<obs_output_t, obs_output_release>;

static std::string wide_to_utf8(const std::wstring &value)
{
	if (value.empty())
		return {};
	int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr,
				       nullptr);
	std::string output(size, '\0');
	WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), output.data(), size, nullptr,
			    nullptr);
	return output;
}

static std::wstring utf8_to_wide(const std::string &value)
{
	if (value.empty())
		return {};
	int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
	std::wstring output(size, L'\0');
	MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), output.data(), size);
	return output;
}

static HMONITOR application_monitor(obs_data_t *application)
{
	DataRef bounds(obs_data_get_obj(application, "bounds"));
	POINT point = {};
	if (bounds) {
		point.x = static_cast<LONG>(obs_data_get_int(bounds, "x") + obs_data_get_int(bounds, "width") / 2);
		point.y = static_cast<LONG>(obs_data_get_int(bounds, "y") + obs_data_get_int(bounds, "height") / 2);
	}
	return MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
}

struct MonitorVideoLevels {
	bool hdr = false;
	float sdr_white_nits = 0.0f;
	float hdr_peak_nits = 0.0f;
};

static float monitor_peak_nits(HMONITOR monitor)
{
	IDXGIFactory1 *factory = nullptr;
	if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), reinterpret_cast<void **>(&factory))))
		return 0.0f;
	float peak_nits = 0.0f;
	for (UINT adapter_index = 0; !peak_nits; ++adapter_index) {
		IDXGIAdapter1 *adapter = nullptr;
		if (FAILED(factory->EnumAdapters1(adapter_index, &adapter)) || !adapter)
			break;
		for (UINT output_index = 0; !peak_nits; ++output_index) {
			IDXGIOutput *output = nullptr;
			if (FAILED(adapter->EnumOutputs(output_index, &output)) || !output)
				break;
			DXGI_OUTPUT_DESC output_desc = {};
			if (SUCCEEDED(output->GetDesc(&output_desc)) && output_desc.Monitor == monitor) {
				IDXGIOutput6 *output6 = nullptr;
				if (SUCCEEDED(output->QueryInterface(__uuidof(IDXGIOutput6), reinterpret_cast<void **>(&output6)))) {
					DXGI_OUTPUT_DESC1 desc = {};
					if (SUCCEEDED(output6->GetDesc1(&desc)) && desc.MaxLuminance > 0.0f)
						peak_nits = desc.MaxLuminance;
					output6->Release();
				}
			}
			output->Release();
		}
		adapter->Release();
	}
	factory->Release();
	return peak_nits;
}

static MonitorVideoLevels monitor_video_levels(HMONITOR monitor)
{
	MonitorVideoLevels levels = {};
	MONITORINFOEXW monitor_info = {};
	monitor_info.cbSize = sizeof(monitor_info);
	if (!GetMonitorInfoW(monitor, &monitor_info))
		return levels;

	UINT32 path_count = 0;
	UINT32 mode_count = 0;
	LONG result = GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &path_count, &mode_count);
	if (result != ERROR_SUCCESS)
		return levels;
	std::vector<DISPLAYCONFIG_PATH_INFO> paths(path_count);
	std::vector<DISPLAYCONFIG_MODE_INFO> modes(mode_count);
	result = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &path_count, paths.data(), &mode_count, modes.data(), nullptr);
	if (result != ERROR_SUCCESS)
		return levels;

	for (UINT32 index = 0; index < path_count; ++index) {
		DISPLAYCONFIG_SOURCE_DEVICE_NAME source_name = {};
		source_name.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
		source_name.header.size = sizeof(source_name);
		source_name.header.adapterId = paths[index].sourceInfo.adapterId;
		source_name.header.id = paths[index].sourceInfo.id;
		if (DisplayConfigGetDeviceInfo(&source_name.header) != ERROR_SUCCESS ||
		    _wcsicmp(source_name.viewGdiDeviceName, monitor_info.szDevice) != 0)
			continue;

		DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO color_info = {};
		color_info.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO;
		color_info.header.size = sizeof(color_info);
		color_info.header.adapterId = paths[index].targetInfo.adapterId;
		color_info.header.id = paths[index].targetInfo.id;
		if (DisplayConfigGetDeviceInfo(&color_info.header) != ERROR_SUCCESS || !color_info.advancedColorEnabled)
			return levels;
		levels.hdr = true;

		DISPLAYCONFIG_SDR_WHITE_LEVEL white_level = {};
		white_level.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL;
		white_level.header.size = sizeof(white_level);
		white_level.header.adapterId = paths[index].targetInfo.adapterId;
		white_level.header.id = paths[index].targetInfo.id;
		if (DisplayConfigGetDeviceInfo(&white_level.header) != ERROR_SUCCESS)
			return levels;
		levels.sdr_white_nits = static_cast<float>(white_level.SDRWhiteLevel) * 80.0f / 1000.0f;
		levels.hdr_peak_nits = monitor_peak_nits(monitor);
		return levels;
	}
	return levels;
}

static std::string path_utf8(const fs::path &value)
{
	return wide_to_utf8(value.wstring());
}

static void log_handler(int level, const char *format, va_list args, void *)
{
	if (level > LOG_INFO)
		return;
	char message[4096];
	vsnprintf(message, sizeof(message), format, args);
	fprintf(stderr, "[libobs] %s\n", message);
	fflush(stderr);
}

static std::string last_output_error(obs_output_t *output, const char *fallback)
{
	const char *error = output ? obs_output_get_last_error(output) : nullptr;
	return error && *error ? error : fallback;
}

static std::string timestamp_name(const std::string &prefix, const std::string &extension)
{
	SYSTEMTIME now;
	GetLocalTime(&now);
	char value[128];
	snprintf(value, sizeof(value), "%s %04u-%02u-%02u %02u-%02u-%02u.%s", prefix.c_str(), now.wYear,
		 now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, extension.c_str());
	return value;
}

static bool encoder_available(const char *wanted)
{
	const char *id = nullptr;
	for (size_t index = 0; obs_enum_encoder_types(index, &id); ++index) {
		if (id && strcmp(id, wanted) == 0)
			return true;
	}
	return false;
}

class CaptureHost {
public:
	~CaptureHost() { shutdown(); }

	void initialize(obs_data_t *request)
	{
		if (initialized_)
			return;

		runtime_root_ = fs::path(utf8_to_wide(obs_data_get_string(request, "runtimeRoot")));
		config_root_ = fs::path(utf8_to_wide(obs_data_get_string(request, "configRoot")));
		if (runtime_root_.empty())
			throw std::runtime_error("The capture runtime path is missing.");

		const fs::path obs_root = runtime_root_ / L"libobs";
		const fs::path bin = obs_root / L"bin" / L"64bit";
		const fs::path data = obs_root / L"data";
		const fs::path plugins = obs_root / L"obs-plugins" / L"64bit";
		if (!fs::exists(bin / L"obs.dll"))
			throw std::runtime_error("The bundled libobs runtime is incomplete.");

		SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | LOAD_LIBRARY_SEARCH_USER_DIRS);
		dll_cookie_ = AddDllDirectory(bin.c_str());
		SetCurrentDirectoryW(bin.c_str());
		fs::create_directories(config_root_);
		base_set_log_handler(log_handler, nullptr);

		const std::string config = path_utf8(config_root_);
		if (!obs_startup("en-US", config.c_str(), nullptr))
			throw std::runtime_error("libobs failed to start.");
		started_ = true;

		const std::string libobs_data = path_utf8(data / L"libobs");
		obs_add_data_path(libobs_data.c_str());

		struct obs_audio_info2 audio = {};
		audio.samples_per_sec = 48000;
		audio.speakers = SPEAKERS_STEREO;
		audio.max_buffering_ms = 1000;
		if (!obs_reset_audio2(&audio))
			throw std::runtime_error("libobs failed to initialize audio.");

		apply_video_settings(request);

		const std::string plugin_pattern = path_utf8(plugins / L"%module%.dll");
		const std::string plugin_data = path_utf8(data / L"obs-plugins" / L"%module%");
		obs_add_module_path(plugin_pattern.c_str(), plugin_data.c_str());
		load_modules(plugins, data / L"obs-plugins");
		obs_post_load_modules();

		if (!obs_source_get_display_name("game_capture"))
			throw std::runtime_error("The bundled libobs game-capture module failed to load.");
		if (!obs_source_get_display_name("wasapi_process_output_capture"))
			throw std::runtime_error("The bundled libobs application-audio module failed to load.");
		if (!obs_source_get_display_name("monitor_capture"))
			throw std::runtime_error("The bundled libobs protected-game fallback failed to load.");
		if (!obs_source_get_display_name("noise_gate_filter"))
			throw std::runtime_error("The bundled libobs microphone noise gate failed to load.");

		scene_.reset(obs_scene_create("Clips Capture Scene"));
		if (!scene_)
			throw std::runtime_error("libobs could not create the capture scene.");
		obs_set_output_source(0, obs_scene_get_source(scene_));

		configure_outputs(request);
		initialized_ = true;
	}

	void configure(obs_data_t *request)
	{
		require_initialized();
		if (recording() || replay_active())
			throw std::runtime_error("Stop recording before changing capture settings.");
		destroy_outputs();
		apply_video_settings(request);
		configure_outputs(request);
	}

	void start(obs_data_t *request)
	{
		require_initialized();
		const std::string directory = obs_data_get_string(request, "directory");
		if (directory.empty())
			throw std::runtime_error("The recording directory is missing.");
		fs::create_directories(fs::path(utf8_to_wide(directory)));
		recording_directory_ = directory;
		obs_data_addref(request);
		session_request_.reset(request);
		capture_started_ = std::chrono::steady_clock::now();
		capture_fallback_checked_ = false;
		set_microphone_volume(request);
		rebuild_sources(request);

		if (!replay_active()) {
			update_replay_output();
			if (!obs_output_start(replay_output_))
				throw std::runtime_error(last_output_error(replay_output_, "The replay buffer failed to start."));
		}

		if (!recording()) {
			DataRef settings(obs_data_create());
			const fs::path output_path =
				fs::path(utf8_to_wide(directory)) / utf8_to_wide(timestamp_name("Recording", extension_));
			obs_data_set_string(settings, "path", path_utf8(output_path).c_str());
			obs_output_update(record_output_, settings);
			if (!obs_output_start(record_output_))
				throw std::runtime_error(last_output_error(record_output_, "Recording failed to start."));
			record_started_ = std::chrono::steady_clock::now();
		}
	}

	void set_microphone_volume(obs_data_t *request)
	{
		const int percent = obs_data_has_user_value(request, "microphoneVolumePercent")
			? std::clamp<int64_t>(obs_data_get_int(request, "microphoneVolumePercent"), 0, 200)
			: 100;
		microphone_volume_ = static_cast<float>(percent) / 100.0f;
		for (const auto &source : sources_) {
			const char *name = obs_source_get_name(source);
			if (name && strcmp(name, "Clips Microphone") == 0)
				obs_source_set_volume(source, microphone_volume_);
		}
		fprintf(stderr, "[capture-host] microphone volume set to %d%%\n", percent);
		fflush(stderr);
	}

	void set_microphone_noise_gate(obs_data_t *request)
	{
		microphone_noise_gate_db_ = static_cast<float>(std::clamp<int64_t>(
			obs_data_get_int(request, "microphoneNoiseGateDb"), -60, -5));
		for (const auto &source : sources_) {
			const char *name = obs_source_get_name(source);
			if (!name || strcmp(name, "Clips Microphone") != 0)
				continue;
			obs_source_t *filter = obs_source_get_filter_by_name(source, "Clips Microphone Noise Gate");
			if (!filter)
				continue;
			DataRef settings(obs_data_create());
			obs_data_set_double(settings, "open_threshold", microphone_noise_gate_db_);
			obs_data_set_double(settings, "close_threshold", microphone_noise_gate_db_ - 3.0f);
			obs_source_update(filter, settings);
			obs_source_release(filter);
		}
	}

	void set_microphone_nvidia_noise_removal(obs_data_t *request)
	{
		microphone_nvidia_noise_removal_ = obs_data_get_bool(request, "microphoneNvidiaNoiseRemoval");
		for (const auto &source : sources_) {
			const char *name = obs_source_get_name(source);
			if (!name || strcmp(name, "Clips Microphone") != 0)
				continue;
			obs_source_t *filter = obs_source_get_filter_by_name(source, "Clips NVIDIA Noise Removal");
			if (filter) {
				obs_source_set_enabled(filter, microphone_nvidia_noise_removal_);
				obs_source_release(filter);
			}
		}
	}

	double microphone_level_db() const { return microphone_level_db_.load(); }

	void stop()
	{
		require_initialized();
		if (recording())
			obs_output_stop(record_output_);
		if (replay_active())
			obs_output_stop(replay_output_);
		wait_for_outputs();
		session_request_.reset();
		capture_fallback_checked_ = false;
	}

	void save_replay()
	{
		require_initialized();
		if (!replay_active())
			throw std::runtime_error("The replay buffer is not active.");
		calldata_t parameters;
		calldata_init(&parameters);
		const bool saved = proc_handler_call(obs_output_get_proc_handler(replay_output_), "save", &parameters);
		calldata_free(&parameters);
		if (!saved)
			throw std::runtime_error("The replay buffer could not save the clip.");
	}

	bool recording() const { return record_output_ && obs_output_active(record_output_); }
	bool replay_active() const { return replay_output_ && obs_output_active(replay_output_); }

	std::vector<std::pair<std::string, std::string>> microphones()
	{
		require_initialized();
		std::vector<std::pair<std::string, std::string>> devices;
		obs_properties_t *properties = obs_get_source_properties("wasapi_input_capture");
		if (!properties)
			return devices;
		obs_property_t *device = obs_properties_get(properties, "device_id");
		const size_t count = device ? obs_property_list_item_count(device) : 0;
		for (size_t index = 0; index < count; ++index) {
			const char *name = obs_property_list_item_name(device, index);
			const char *id = obs_property_list_item_string(device, index);
			if (name && id)
				devices.emplace_back(id, name);
		}
		obs_properties_destroy(properties);
		return devices;
	}

	uint64_t duration_ms() const
	{
		if (!recording())
			return 0;
		return static_cast<uint64_t>(
			std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() -
									     record_started_)
				.count());
	}

	bool initialized() const { return initialized_; }

	void refresh_capture()
	{
		if (!recording() || capture_fallback_checked_ || !session_request_)
			return;
		if (std::chrono::steady_clock::now() - capture_started_ < std::chrono::seconds(5))
			return;
		capture_fallback_checked_ = true;

		bool hook_failed = false;
		for (const auto &source : sources_) {
			const char *name = obs_source_get_name(source);
			if (name && strncmp(name, "Clips Video - ", 14) == 0 &&
			    (!obs_source_get_width(source) || !obs_source_get_height(source))) {
				hook_failed = true;
				break;
			}
		}
		if (!hook_failed)
			return;

		DataArrayRef applications(obs_data_get_array(session_request_, "applications"));
		const size_t count = applications ? obs_data_array_count(applications) : 0;
		for (size_t index = 0; index < count; ++index) {
			DataRef application(obs_data_array_item(applications, index));
			if (obs_data_get_bool(application, "captureVideo"))
				obs_data_set_bool(application, "captureDisplay", true);
		}
		fprintf(stderr, "[capture-host] game hook produced no frames; switching to display capture\n");
		fflush(stderr);
		rebuild_sources(session_request_);
	}

	void shutdown()
	{
		if (!obs_started())
			return;
		stop_noexcept();
		if (microphone_meter_) {
			obs_volmeter_detach_source(microphone_meter_);
			obs_volmeter_destroy(microphone_meter_);
			microphone_meter_ = nullptr;
		}
		obs_set_output_source(0, nullptr);
		destroy_outputs();
		obs_scene_enum_items(
			scene_,
			[](obs_scene_t *, obs_sceneitem_t *item, void *) {
				obs_sceneitem_remove(item);
				return true;
			},
			nullptr);
		release_sources();
		scene_.reset();
		obs_wait_for_destroy_queue();
		obs_shutdown();
		started_ = false;
		initialized_ = false;
		if (dll_cookie_) {
			RemoveDllDirectory(dll_cookie_);
			dll_cookie_ = nullptr;
		}
	}

private:
	bool obs_started() const { return started_; }

	void require_initialized() const
	{
		if (!initialized_)
			throw std::runtime_error("The capture host is not initialized.");
	}

	void apply_video_settings(obs_data_t *request)
	{
		const uint32_t width = std::max<int64_t>(640, obs_data_get_int(request, "width"));
		const uint32_t height = std::max<int64_t>(360, obs_data_get_int(request, "height"));
		const uint32_t fps = std::clamp<int64_t>(obs_data_get_int(request, "fps"), 24, 240);

		struct obs_video_info video = {};
		video.graphics_module = "libobs-d3d11.dll";
		video.fps_num = fps;
		video.fps_den = 1;
		video.base_width = width;
		video.base_height = height;
		video.output_width = width;
		video.output_height = height;
		video.output_format = VIDEO_FORMAT_NV12;
		video.adapter = 0;
		video.gpu_conversion = true;
		video.colorspace = VIDEO_CS_709;
		video.range = VIDEO_RANGE_PARTIAL;
		video.scale_type = OBS_SCALE_BICUBIC;
		const int result = obs_reset_video(&video);
		if (result != OBS_VIDEO_SUCCESS)
			throw std::runtime_error("libobs failed to initialize Direct3D video (error " +
						 std::to_string(result) + ").");
		width_ = width;
		height_ = height;
		fps_ = fps;
	}

	void load_modules(const fs::path &plugins, const fs::path &data_root)
	{
		static const wchar_t *names[] = {
			L"win-capture", L"win-wasapi", L"obs-ffmpeg", L"obs-x264",
			L"obs-nvenc",   L"obs-qsv11",  L"coreaudio-encoder", L"obs-filters", L"nv-filters",
		};
		for (const wchar_t *name : names) {
			const fs::path binary = plugins / (std::wstring(name) + L".dll");
			if (!fs::exists(binary))
				continue;
			obs_module_t *module = nullptr;
			const std::string binary_utf8 = path_utf8(binary);
			const std::string data_utf8 = path_utf8(data_root / name);
			const int result = obs_open_module(&module, binary_utf8.c_str(), data_utf8.c_str());
			if (result == MODULE_SUCCESS && module)
				obs_init_module(module);
			else
				fprintf(stderr, "[capture-host] module %ls failed with code %d\n", name, result);
		}
	}

	void configure_outputs(obs_data_t *request)
	{
		quality_ = obs_data_get_string(request, "quality");
		extension_ = obs_data_get_string(request, "format");
		if (extension_ != "mkv" && extension_ != "mp4" && extension_ != "mov")
			extension_ = "mkv";
		clip_seconds_ = std::max<int64_t>(5, obs_data_get_int(request, "clipLengthSeconds"));

		create_video_encoder();
		create_audio_encoders();

		record_output_.reset(obs_output_create("ffmpeg_muxer", "Clips Recording", nullptr, nullptr));
		replay_output_.reset(obs_output_create("replay_buffer", "Clips Replay Buffer", nullptr, nullptr));
		if (!record_output_ || !replay_output_)
			throw std::runtime_error("libobs could not create its recording outputs.");

		for (obs_output_t *output : {record_output_.get(), replay_output_.get()}) {
			obs_output_set_video_encoder(output, video_encoder_);
		}
		if (!recording() && !replay_active())
			configure_output_audio_tracks();
	}

	void create_video_encoder()
	{
		static const char *ids[] = {
			"obs_nvenc_h264_tex", "obs_qsv11_v2", "h264_texture_amf", "ffmpeg_nvenc", "obs_x264",
		};
		const char *selected = nullptr;
		for (const char *id : ids) {
			if (!encoder_available(id))
				continue;
			EncoderRef candidate(obs_video_encoder_create(id, "Clips Video Encoder", nullptr, nullptr));
			if (candidate) {
				video_encoder_ = std::move(candidate);
				selected = id;
				break;
			}
		}
		if (!video_encoder_)
			throw std::runtime_error("No compatible H.264 encoder is available.");

		const int quality_value = quality_ == "Lossless" ? 1 : quality_ == "Small" ? 23 : quality_ == "Stream" ? 20 : 16;
		DataRef settings(obs_data_create());
		if (std::string(selected).find("nvenc") != std::string::npos) {
			obs_data_set_string(settings, "rate_control", "CQP");
			obs_data_set_int(settings, "cqp", quality_value);
			obs_data_set_string(settings, "preset", "p5");
			obs_data_set_string(settings, "profile", "high");
		} else if (std::string(selected).find("qsv") != std::string::npos) {
			obs_data_set_string(settings, "rate_control", "ICQ");
			obs_data_set_int(settings, "icq_quality", quality_value);
			obs_data_set_string(settings, "profile", "high");
		} else if (std::string(selected).find("amf") != std::string::npos) {
			obs_data_set_string(settings, "rate_control", "CQP");
			obs_data_set_int(settings, "cqp", quality_value);
			obs_data_set_string(settings, "preset", "quality");
			obs_data_set_string(settings, "profile", "high");
		} else {
			obs_data_set_string(settings, "rate_control", "CRF");
			obs_data_set_int(settings, "crf", quality_value);
			obs_data_set_string(settings, "preset", "veryfast");
			obs_data_set_string(settings, "profile", "high");
		}
		obs_encoder_update(video_encoder_, settings);
		obs_encoder_set_video(video_encoder_, obs_get_video());
	}

	void create_audio_encoders()
	{
		static const char *ids[] = {"ffmpeg_aac", "mf_aac", "CoreAudio_AAC"};
		const char *selected = nullptr;
		for (const char *id : ids) {
			EncoderRef candidate(obs_audio_encoder_create(id, "Combined", nullptr, 0, nullptr));
			if (candidate) {
				audio_encoders_.push_back(std::move(candidate));
				selected = id;
				break;
			}
		}
		if (audio_encoders_.empty())
			throw std::runtime_error("No compatible AAC audio encoder is available.");
		for (size_t mixer = 1; mixer < MAX_AUDIO_MIXES; ++mixer) {
			EncoderRef encoder(obs_audio_encoder_create(selected, ("Clips track " + std::to_string(mixer + 1)).c_str(),
								 nullptr, mixer, nullptr));
			if (!encoder)
				throw std::runtime_error("Could not create the multi-track AAC encoders.");
			audio_encoders_.push_back(std::move(encoder));
		}
		for (auto &encoder : audio_encoders_) {
			DataRef settings(obs_data_create());
			obs_data_set_int(settings, "bitrate", 192);
			obs_data_set_string(settings, "rate_control", "CBR");
			obs_encoder_update(encoder, settings);
			obs_encoder_set_audio(encoder, obs_get_audio());
		}
	}

	void configure_output_audio_tracks()
	{
		if (active_audio_track_names_.empty())
			active_audio_track_names_.push_back("Combined");
		for (size_t index = 0; index < audio_encoders_.size(); ++index) {
			const bool active = index < active_audio_track_names_.size();
			if (active)
				obs_encoder_set_name(audio_encoders_[index], active_audio_track_names_[index].c_str());
			for (obs_output_t *output : {record_output_.get(), replay_output_.get()})
				obs_output_set_audio_encoder(output, active ? audio_encoders_[index].get() : nullptr, index);
		}
	}

	void rebuild_sources(obs_data_t *request)
	{
		release_sources();
		if (microphone_meter_)
			obs_volmeter_detach_source(microphone_meter_);
		microphone_level_db_ = -60.0f;
		obs_scene_enum_items(
			scene_,
			[](obs_scene_t *, obs_sceneitem_t *item, void *) {
				obs_sceneitem_remove(item);
				return true;
			},
			nullptr);

		DataArrayRef applications(obs_data_get_array(request, "applications"));
		const size_t count = applications ? obs_data_array_count(applications) : 0;
		for (size_t index = 0; index < count; ++index) {
			DataRef application(obs_data_array_item(applications, index));
			if (!obs_data_get_bool(application, "captureVideo"))
				continue;
			const HMONITOR monitor = application_monitor(application);
			const MonitorVideoLevels levels = monitor_video_levels(monitor);
			const float sdr_white_nits = levels.sdr_white_nits > 0.0f
				? levels.sdr_white_nits : obs_get_video_sdr_white_level();
			const float hdr_peak_nits = levels.hdr_peak_nits > 0.0f
				? levels.hdr_peak_nits : obs_get_video_hdr_nominal_peak_level();
			if (levels.hdr)
				obs_set_video_levels(sdr_white_nits, hdr_peak_nits);
			MONITORINFOEXA monitor_info = {};
			monitor_info.cbSize = sizeof(monitor_info);
			GetMonitorInfoA(monitor, &monitor_info);
			fprintf(stderr, "[capture-host] video source=%s display=%s hdr=%s sdr-white=%.0f nits hdr-peak=%.0f nits\n",
				obs_data_get_string(application, "name"), monitor_info.szDevice, levels.hdr ? "true" : "false",
				sdr_white_nits, hdr_peak_nits);
			fflush(stderr);
			break;
		}
		const std::string microphone_id = obs_data_get_string(request, "microphoneDeviceId");
		const bool has_microphone = !microphone_id.empty() && microphone_id != "disabled";
		size_t audio_application_count = 0;
		for (size_t index = 0; index < count; ++index) {
			DataRef application(obs_data_array_item(applications, index));
			if (obs_data_get_bool(application, "captureAudio"))
				++audio_application_count;
		}
		const size_t application_track_capacity = MAX_AUDIO_MIXES - 1 - (has_microphone ? 1 : 0);
		const bool group_extra_applications = audio_application_count > application_track_capacity;
		const size_t individual_application_count = group_extra_applications
			? application_track_capacity - 1
			: audio_application_count;
		active_audio_track_names_.clear();
		active_audio_track_names_.push_back("Combined");
		size_t audio_application_index = 0;
		size_t requested_video_sources = 0;
		size_t created_video_sources = 0;
		for (size_t index = 0; index < count; ++index) {
			DataRef application(obs_data_array_item(applications, index));
			const std::string executable = obs_data_get_string(application, "name");
			const std::string title = obs_data_get_string(application, "title");
			const std::string window_class = obs_data_get_string(application, "windowClass");
			const bool capture_video = obs_data_get_bool(application, "captureVideo");
			const bool capture_display = obs_data_get_bool(application, "captureDisplay");
			const bool capture_audio = obs_data_get_bool(application, "captureAudio");
			const std::string window = title + ":" + window_class + ":" + executable;

			if (capture_video) {
				++requested_video_sources;
				DataRef settings(obs_data_create());
				obs_data_set_bool(settings, "capture_cursor", false);
				const char *source_id = "game_capture";
				std::string source_name = "Clips Video - " + executable;
				if (capture_display) {
					if (executable != "clips-desktop-capture") {
						source_id = "window_capture";
						source_name = "Clips Protected Window - " + executable;
						obs_data_set_string(settings, "window", window.c_str());
						obs_data_set_int(settings, "priority", 2);
						obs_data_set_int(settings, "method", 2);
						obs_data_set_bool(settings, "client_area", true);
						obs_data_set_bool(settings, "force_sdr", false);
					} else {
						const HMONITOR monitor = application_monitor(application);
						MONITORINFOEXA monitor_info = {};
						monitor_info.cbSize = sizeof(monitor_info);
						if (!GetMonitorInfoA(monitor, &monitor_info))
							throw std::runtime_error("Clips could not identify the protected game's display.");
						source_id = "monitor_capture";
						source_name = "Clips Protected Display - " + executable;
						obs_data_set_string(settings, "monitor_id", monitor_info.szDevice);
						// WGC remains available when protected games reject injected hooks,
						// and avoids DXGI duplication failures on HDR/high-refresh displays.
						obs_data_set_int(settings, "method", 2);
						obs_data_set_bool(settings, "force_sdr", true);
					}
				} else {
					obs_data_set_string(settings, "capture_mode", "window");
					obs_data_set_string(settings, "window", window.c_str());
					// HDR games commonly expose RGB10A2 swapchains. Tag those frames as
					// Rec. 2100 PQ so libobs tone-maps them into our Rec. 709 SDR output.
					obs_data_set_string(settings, "rgb10a2_space", "2100pq");
					obs_data_set_int(settings, "priority", 2);
					obs_data_set_bool(settings, "allow_transparency", false);
					obs_data_set_bool(settings, "capture_audio", false);
				}
				SourceRef source(obs_source_create(source_id, source_name.c_str(), settings, nullptr));
				if (source) {
					obs_sceneitem_t *item = obs_scene_add(scene_, source);
					struct vec2 bounds = {static_cast<float>(width_), static_cast<float>(height_)};
					obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER);
					obs_sceneitem_set_bounds_alignment(item, OBS_ALIGN_CENTER);
					obs_sceneitem_set_bounds(item, &bounds);
					obs_source_inc_showing(source);
					obs_source_inc_active(source);
					sources_.push_back(std::move(source));
					++created_video_sources;
				}
			}

			if (capture_audio) {
				const bool grouped = group_extra_applications && audio_application_index >= individual_application_count;
				const size_t mixer_index = grouped ? application_track_capacity : audio_application_index + 1;
				const bool desktop_audio = executable == "clips-desktop-capture";
				const std::string track_name = desktop_audio ? "Desktop audio" : executable;
				if (!grouped)
					active_audio_track_names_.push_back(track_name);
				else if (active_audio_track_names_.size() <= mixer_index)
					active_audio_track_names_.push_back("Other applications");
				DataRef settings(obs_data_create());
				const char *audio_source_id = desktop_audio ? "wasapi_output_capture" : "wasapi_process_output_capture";
				if (!desktop_audio) {
					obs_data_set_string(settings, "window", window.c_str());
					obs_data_set_int(settings, "priority", 2);
				}
				SourceRef source(obs_source_create(audio_source_id,
								  ("Clips Audio - " + track_name).c_str(), settings, nullptr));
				if (source) {
					obs_scene_add(scene_, source);
					obs_source_set_audio_mixers(source, 1u | (1u << mixer_index));
					obs_source_inc_showing(source);
					obs_source_inc_active(source);
					sources_.push_back(std::move(source));
				}
				++audio_application_index;
			}
		}
		if (has_microphone) {
			DataRef settings(obs_data_create());
			obs_data_set_string(settings, "device_id", microphone_id.c_str());
			obs_data_set_bool(settings, "use_device_timing", false);
			SourceRef source(obs_source_create("wasapi_input_capture", "Clips Microphone", settings, nullptr));
			if (!source)
				throw std::runtime_error("The selected microphone is not available.");
			obs_scene_add(scene_, source);
			const size_t microphone_mixer_index = active_audio_track_names_.size();
			active_audio_track_names_.push_back("Microphone");
			obs_source_set_audio_mixers(source, 1u | (1u << microphone_mixer_index));
			obs_source_set_volume(source, microphone_volume_);
			microphone_nvidia_noise_removal_ = !obs_data_has_user_value(request, "microphoneNvidiaNoiseRemoval") ||
				obs_data_get_bool(request, "microphoneNvidiaNoiseRemoval");
			if (obs_source_get_display_name("nvidia_audiofx_filter")) {
				DataRef nvidia_settings(obs_data_create());
				obs_data_set_string(nvidia_settings, "method", "denoiser");
				obs_data_set_double(nvidia_settings, "intensity", 1.0);
				SourceRef nvidia_filter(obs_source_create_private("nvidia_audiofx_filter",
					"Clips NVIDIA Noise Removal", nvidia_settings));
				if (nvidia_filter) {
					obs_source_set_enabled(nvidia_filter, microphone_nvidia_noise_removal_);
					obs_source_filter_add(source, nvidia_filter);
				} else {
					fprintf(stderr, "[capture-host] NVIDIA microphone filter could not initialize; continuing without it\n");
				}
			}
			DataRef gate_settings(obs_data_create());
			microphone_noise_gate_db_ = static_cast<float>(std::clamp<int64_t>(
				obs_data_get_int(request, "microphoneNoiseGateDb"), -60, -5));
			obs_data_set_double(gate_settings, "open_threshold", microphone_noise_gate_db_);
			obs_data_set_double(gate_settings, "close_threshold", microphone_noise_gate_db_ - 3.0f);
			obs_data_set_int(gate_settings, "attack_time", 25);
			obs_data_set_int(gate_settings, "hold_time", 200);
			obs_data_set_int(gate_settings, "release_time", 150);
			SourceRef gate(obs_source_create_private("noise_gate_filter", "Clips Microphone Noise Gate", gate_settings));
			if (!gate)
				throw std::runtime_error("The microphone noise gate filter is unavailable.");
			obs_source_filter_add(source, gate);
			if (!microphone_meter_) {
				microphone_meter_ = obs_volmeter_create(OBS_FADER_LOG);
				obs_volmeter_add_callback(microphone_meter_, microphone_meter_updated, this);
			}
			obs_volmeter_attach_source(microphone_meter_, source);
			obs_source_inc_showing(source);
			obs_source_inc_active(source);
			fprintf(stderr, "[capture-host] microphone source created: device=%s flags=%u mixers=%u\n",
				microphone_id.c_str(), obs_source_get_output_flags(source),
				obs_source_get_audio_mixers(source));
			fflush(stderr);
			sources_.push_back(std::move(source));
		}
		if (requested_video_sources && !created_video_sources)
			throw std::runtime_error("No video capture source was available for the active game.");
		if (sources_.empty())
			throw std::runtime_error("No active game capture sources were available.");
		if (!recording() && !replay_active())
			configure_output_audio_tracks();
	}

	static void microphone_meter_updated(void *parameter, const float magnitude[MAX_AUDIO_CHANNELS],
					     const float peak[MAX_AUDIO_CHANNELS], const float[MAX_AUDIO_CHANNELS])
	{
		auto *host = static_cast<CaptureHost *>(parameter);
		host->microphone_level_db_ = (std::max)(magnitude[0], peak[0]);
	}

	void release_sources()
	{
		for (const auto &source : sources_)
			obs_source_dec_active(source.get());
		for (const auto &source : sources_)
			obs_source_dec_showing(source.get());
		sources_.clear();
	}

	void update_replay_output()
	{
		DataRef settings(obs_data_create());
		obs_data_set_string(settings, "directory", recording_directory_.c_str());
		obs_data_set_string(settings, "format", "Replay %CCYY-%MM-%DD %hh-%mm-%ss");
		obs_data_set_string(settings, "extension", extension_.c_str());
		obs_data_set_bool(settings, "allow_spaces", true);
		obs_data_set_int(settings, "max_time_sec", clip_seconds_);
		obs_data_set_int(settings, "max_size_mb", 0);
		obs_output_update(replay_output_, settings);
	}

	void wait_for_outputs()
	{
		for (int attempt = 0; attempt < 100 && (recording() || replay_active()); ++attempt)
			std::this_thread::sleep_for(std::chrono::milliseconds(50));
		if (recording())
			obs_output_force_stop(record_output_);
		if (replay_active())
			obs_output_force_stop(replay_output_);
	}

	void stop_noexcept()
	{
		try {
			if (recording())
				obs_output_stop(record_output_);
			if (replay_active())
				obs_output_stop(replay_output_);
			wait_for_outputs();
		} catch (...) {
		}
	}

	void destroy_outputs()
	{
		stop_noexcept();
		record_output_.reset();
		replay_output_.reset();
		video_encoder_.reset();
		audio_encoders_.clear();
	}

	fs::path runtime_root_;
	fs::path config_root_;
	DLL_DIRECTORY_COOKIE dll_cookie_ = nullptr;
	bool started_ = false;
	bool initialized_ = false;
	uint32_t width_ = 1920;
	uint32_t height_ = 1080;
	uint32_t fps_ = 60;
	int clip_seconds_ = 60;
	float microphone_volume_ = 1.0f;
	float microphone_noise_gate_db_ = -40.0f;
	bool microphone_nvidia_noise_removal_ = true;
	std::atomic<float> microphone_level_db_{-60.0f};
	obs_volmeter_t *microphone_meter_ = nullptr;
	std::string quality_ = "HQ";
	std::string extension_ = "mkv";
	std::string recording_directory_;
	std::chrono::steady_clock::time_point record_started_;
	std::chrono::steady_clock::time_point capture_started_;
	DataRef session_request_;
	bool capture_fallback_checked_ = false;
	SceneRef scene_;
	std::vector<SourceRef> sources_;
	EncoderRef video_encoder_;
	std::vector<EncoderRef> audio_encoders_;
	std::vector<std::string> active_audio_track_names_{"Combined"};
	OutputRef record_output_;
	OutputRef replay_output_;
};

static void send_response(int64_t id, bool ok, const std::string &error, CaptureHost &host,
			  const std::vector<std::pair<std::string, std::string>> *devices = nullptr,
			  bool include_microphone_level = false)
{
	DataRef response(obs_data_create());
	obs_data_set_int(response, "id", id);
	obs_data_set_bool(response, "ok", ok);
	if (!error.empty())
		obs_data_set_string(response, "error", error.c_str());
	obs_data_set_bool(response, "connected", host.initialized());
	obs_data_set_bool(response, "recording", host.recording());
	obs_data_set_bool(response, "replayBuffer", host.replay_active());
	obs_data_set_int(response, "durationMs", static_cast<long long>(host.duration_ms()));
	if (devices) {
		DataArrayRef items(obs_data_array_create());
		for (const auto &[device_id, device_name] : *devices) {
			DataRef item(obs_data_create());
			obs_data_set_string(item, "id", device_id.c_str());
			obs_data_set_string(item, "name", device_name.c_str());
			obs_data_array_push_back(items, item);
		}
		obs_data_set_array(response, "devices", items);
	}
	if (include_microphone_level)
		obs_data_set_double(response, "microphoneLevelDb", host.microphone_level_db());
	const char *json = obs_data_get_json(response);
	fprintf(stdout, "%s\n", json);
	fflush(stdout);
}

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int)
{
	SetConsoleOutputCP(CP_UTF8);
	std::ios::sync_with_stdio(false);
	CaptureHost host;
	std::string line;
	while (std::getline(std::cin, line)) {
		DataRef request(obs_data_create_from_json(line.c_str()));
		const int64_t id = request ? obs_data_get_int(request, "id") : 0;
		try {
			if (!request)
				throw std::runtime_error("Invalid capture-host request.");
			const std::string command = obs_data_get_string(request, "command");
			if (command == "initialize")
				host.initialize(request);
			else if (command == "configure")
				host.configure(request);
			else if (command == "start")
				host.start(request);
			else if (command == "stop")
				host.stop();
			else if (command == "save")
				host.save_replay();
			else if (command == "microphones") {
				const auto devices = host.microphones();
				send_response(id, true, {}, host, &devices);
				continue;
			}
			else if (command == "microphoneVolume")
				host.set_microphone_volume(request);
			else if (command == "microphoneNoiseGate")
				host.set_microphone_noise_gate(request);
			else if (command == "microphoneNvidiaNoiseRemoval")
				host.set_microphone_nvidia_noise_removal(request);
			else if (command == "microphoneLevel") {
				send_response(id, true, {}, host, nullptr, true);
				continue;
			}
			else if (command == "status") {
				host.refresh_capture();
			} else if (command == "shutdown") {
				host.shutdown();
				send_response(id, true, {}, host);
				break;
			} else {
				throw std::runtime_error("Unknown capture-host command.");
			}
			send_response(id, true, {}, host);
		} catch (const std::exception &error) {
			send_response(id, false, error.what(), host);
		} catch (...) {
			send_response(id, false, "The capture host failed unexpectedly.", host);
		}
	}
	host.shutdown();
	return 0;
}
