#version 130

in vec2 fragPos;
in vec2 UV;

// Ouput data
out vec3 color;

uniform sampler2D ambient;
uniform vec3 drawColor;

void main()
{
	color = texture2D(ambient, UV).rgb * drawColor;
}
