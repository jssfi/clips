#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <mpv/client.h>
#include <mpv/render.h>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

static HWND videoWindow = nullptr;
static mpv_handle* player = nullptr;
static mpv_render_context* renderer = nullptr;
static std::atomic<bool> running{true};
static std::atomic<bool> frameReady{true};
static std::atomic<int> frameWidth{640};
static std::atomic<int> frameHeight{360};

static void respond(long long id, const std::string& body) {
  std::cerr << id << '\t' << body << std::endl;
}

static void commandLoop() {
  std::string line;
  while (running && std::getline(std::cin, line)) {
    std::istringstream stream(line);
    std::string command;
    long long id = 0;
    stream >> command >> id;
    if (command == "status") {
      double duration = 0, position = 0;
      int paused = 1;
      mpv_get_property(player, "duration", MPV_FORMAT_DOUBLE, &duration);
      mpv_get_property(player, "time-pos", MPV_FORMAT_DOUBLE, &position);
      mpv_get_property(player, "pause", MPV_FORMAT_FLAG, &paused);
      std::ostringstream result;
      result << "status\t" << duration << '\t' << position << '\t' << paused;
      respond(id, result.str());
    } else if (command == "seek") {
      double seconds = 0;
      stream >> seconds;
      mpv_set_property(player, "time-pos", MPV_FORMAT_DOUBLE, &seconds);
      respond(id, "ok");
    } else if (command == "pause") {
      int paused = 1;
      stream >> paused;
      mpv_set_property(player, "pause", MPV_FORMAT_FLAG, &paused);
      respond(id, "ok");
    } else if (command == "toggle") {
      const char* args[] = {"cycle", "pause", nullptr};
      mpv_command(player, args);
      respond(id, "ok");
    } else if (command == "volume") {
      double volume = 100;
      stream >> volume;
      volume = max(0.0, min(100.0, volume));
      mpv_set_property(player, "volume", MPV_FORMAT_DOUBLE, &volume);
      respond(id, "ok");
    } else if (command == "bounds") {
      int x = 0, y = 0, width = 1, height = 1;
      stream >> x >> y >> width >> height;
      frameWidth = max(1, width);
      frameHeight = max(1, height);
      frameReady = true;
      respond(id, "ok");
    } else if (command == "quit") {
      respond(id, "ok");
      running = false;
      PostMessage(videoWindow, WM_CLOSE, 0, 0);
    }
  }
}

static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_TIMER && player && renderer) {
    while (mpv_wait_event(player, 0)->event_id != MPV_EVENT_NONE) {}
    if (frameReady.exchange(false) && (mpv_render_context_update(renderer) & MPV_RENDER_UPDATE_FRAME)) {
      const int width = frameWidth.load(), height = frameHeight.load();
      size_t stride = static_cast<size_t>(width) * 4;
      std::vector<unsigned char> pixels(stride * height);
      int size[] = {width, height};
      char format[] = "rgb0";
      void* pointer = pixels.data();
      mpv_render_param params[] = {
        {MPV_RENDER_PARAM_SW_SIZE, size},
        {MPV_RENDER_PARAM_SW_FORMAT, format},
        {MPV_RENDER_PARAM_SW_STRIDE, &stride},
        {MPV_RENDER_PARAM_SW_POINTER, pointer},
        {MPV_RENDER_PARAM_INVALID, nullptr}
      };
      if (mpv_render_context_render(renderer, params) >= 0) {
        for (size_t index = 3; index < pixels.size(); index += 4) pixels[index] = 255;
        uint32_t header[] = {static_cast<uint32_t>(width), static_cast<uint32_t>(height), static_cast<uint32_t>(pixels.size())};
        DWORD written = 0;
        HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
        WriteFile(output, header, sizeof(header), &written, nullptr);
        WriteFile(output, pixels.data(), static_cast<DWORD>(pixels.size()), &written, nullptr);
      }
    }
    return 0;
  }
  if (message == WM_ERASEBKGND) return 1;
  if (message == WM_CLOSE) {
    running = false;
    DestroyWindow(window);
    return 0;
  }
  if (message == WM_DESTROY) {
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  int argc = 0;
  wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (argc < 7) return 2;
  int x = _wtoi(argv[2]), y = _wtoi(argv[3]), width = _wtoi(argv[4]), height = _wtoi(argv[5]);
  frameWidth = max(1, width);
  frameHeight = max(1, height);
  std::wstring file = argv[6];

  WNDCLASSW windowClass{};
  windowClass.lpfnWndProc = windowProc;
  windowClass.hInstance = instance;
  windowClass.lpszClassName = L"JssClipsLibmpvHost";
  windowClass.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassW(&windowClass);
  videoWindow = CreateWindowExW(0, windowClass.lpszClassName, L"", 0,
    0, 0, 1, 1, HWND_MESSAGE, nullptr, instance, nullptr);
  if (!videoWindow) return 3;
  SetTimer(videoWindow, 1, 25, nullptr);

  player = mpv_create();
  if (!player) return 4;
  mpv_set_option_string(player, "vo", "libmpv");
  mpv_set_option_string(player, "hwdec", "auto-copy");
  mpv_set_option_string(player, "keep-open", "yes");
  mpv_set_option_string(player, "pause", "yes");
  if (mpv_initialize(player) < 0) return 5;
  const char* api = MPV_RENDER_API_TYPE_SW;
  mpv_render_param createParams[] = {
    {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(api)},
    {MPV_RENDER_PARAM_INVALID, nullptr}
  };
  if (mpv_render_context_create(&renderer, player, createParams) < 0) return 6;
  mpv_render_context_set_update_callback(renderer, [](void*) { frameReady = true; }, nullptr);

  std::string utf8File;
  int bytes = WideCharToMultiByte(CP_UTF8, 0, file.c_str(), -1, nullptr, 0, nullptr, nullptr);
  utf8File.resize(bytes);
  WideCharToMultiByte(CP_UTF8, 0, file.c_str(), -1, utf8File.data(), bytes, nullptr, nullptr);
  const char* load[] = {"loadfile", utf8File.c_str(), nullptr};
  mpv_command_async(player, 0, load);

  std::thread input(commandLoop);
  std::cerr << "0\tready" << std::endl;
  MSG message;
  while (running && GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  running = false;
  if (renderer) mpv_render_context_free(renderer);
  renderer = nullptr;
  mpv_terminate_destroy(player);
  player = nullptr;
  if (input.joinable()) input.detach();
  LocalFree(argv);
  return 0;
}
